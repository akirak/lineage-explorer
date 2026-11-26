// ---------------------------------------------------------------------------
// Assemble the query results into the graph the views render.
//
// The SQL columns are nullable until the database schema says otherwise, and
// DuckDB does not enforce NOT NULL, so every identifier is validated here. A
// namespace or name of NULL cannot identify a node or edge. Skip the row and
// report it, rather than building a node whose name later breaks sorting and
// rendering.
// ---------------------------------------------------------------------------
import { schema as s } from '../shared/schema.ts';
import type { ColumnEdge, Crud, DatasetField, DatasetNode, Graph, LineageEdge, LineageNode } from '../shared/types.ts';

export interface NameRow {
  namespace: string | null;
  name: string | null;
  title: string | null;
  description: string | null;
  archetype: string | null;
}

export interface IoRow {
  dataset_namespace: string | null;
  dataset_name: string | null;
  job_namespace: string | null;
  job_name: string | null;
}

export interface WriteRow extends IoRow {
  crud: string | null;
}

export interface FieldRow {
  dataset_namespace: string | null;
  dataset_name: string | null;
  name: string | null;
  type: string | null;
  description: string | null;
  required: string | null;
}

export interface ColumnLineageRow {
  job_namespace: string | null;
  job_name: string | null;
  input_namespace: string | null;
  input_dataset: string | null;
  input_field: string | null;
  output_namespace: string | null;
  output_dataset: string | null;
  output_field: string | null;
  transformation_type: string | null;
  transformation_subtype: string | null;
  description: string | null;
}

export interface ViewRow {
  view_namespace: string | null;
  view_name: string | null;
  base_namespace: string | null;
  base_name: string | null;
}

/** Rows returned by the graph queries, keyed by the query that produced them. */
export type GraphRows = {
  jobs: NameRow[];
  datasets: NameRow[];
  reads: IoRow[];
  writes: WriteRow[];
  fields: FieldRow[];
  columnLineage: ColumnLineageRow[];
  views: ViewRow[];
};

/** Most destructive first, so conflicting job_output rows keep the strongest marker. */
const CRUD_ORDER: Crud[] = ['D', 'U', 'C'];

/** Normalize job_output.crud to C, U or D; anything else is ignored. */
function normalizeCrud(value: string | null): Crud | null {
  const crud = value?.trim().toUpperCase();
  return crud === 'C' || crud === 'U' || crud === 'D' ? crud : null;
}

/** Interpret the optional dataset_field.required column as a boolean. */
function normalizeRequired(value: string | null): boolean {
  const required = value?.trim().toLowerCase();
  return required === 'true' || required === 't' || required === '1' || required === 'yes' || required === 'y';
}

const jobId = (ns: string, name: string) => `job:${ns}\u0000${name}`;
const datasetId = (ns: string, name: string) => `dataset:${ns}\u0000${name}`;

const isIdentifier = (value: string | null): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** Build the full lineage graph from the query results. */
export function assembleGraph(rows: GraphRows): Graph {
  const skipped = new Map<string, number>();
  const skip = (table: string) => skipped.set(table, (skipped.get(table) ?? 0) + 1);

  const nodes = new Map<string, LineageNode>();
  const addJob = (
    source: string,
    namespace: string | null,
    name: string | null,
    title: string | null = null,
    description: string | null = null,
    archetype: string | null = null,
  ): string | null => {
    if (!isIdentifier(namespace) || !isIdentifier(name)) {
      skip(source);
      return null;
    }
    const id = jobId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'job', namespace, name, title, description, archetype });
    return id;
  };
  const addDataset = (
    source: string,
    namespace: string | null,
    name: string | null,
    title: string | null = null,
    description: string | null = null,
    archetype: string | null = null,
  ): DatasetNode | null => {
    if (!isIdentifier(namespace) || !isIdentifier(name)) {
      skip(source);
      return null;
    }
    const id = datasetId(namespace, name);
    if (!nodes.has(id)) {
      nodes.set(id, { id, type: 'dataset', namespace, name, title, description, archetype, fields: [] });
    }
    const dataset = nodes.get(id);
    return dataset?.type === 'dataset' ? dataset : null;
  };
  const addField = (dataset: DatasetNode, field: DatasetField) => {
    if (!dataset.fields.some((f) => f.name === field.name)) dataset.fields.push(field);
  };

  for (const job of rows.jobs) {
    addJob(s.job.table, job.namespace, job.name, job.title, job.description, job.archetype);
  }
  for (const dataset of rows.datasets) {
    addDataset(s.dataset.table, dataset.namespace, dataset.name, dataset.title, dataset.description, dataset.archetype);
  }
  for (const field of rows.fields) {
    if (!isIdentifier(field.name)) {
      skip(s.field.table);
      continue;
    }
    const dataset = addDataset(s.field.table, field.dataset_namespace, field.dataset_name);
    if (!dataset) continue;
    addField(dataset, {
      name: field.name,
      type: field.type ?? null,
      description: field.description ?? null,
      required: normalizeRequired(field.required),
    });
  }

  const edges = new Map<string, LineageEdge>();
  const addEdge = (source: string, target: string, kind: 'io' | 'view' = 'io', crud: Crud | null = null) => {
    const id = `${source}->${target}`;
    const existing = edges.get(id);
    if (!existing) {
      edges.set(id, { id, source, target, kind, crud });
      return;
    }
    // Several job_output rows can describe the same pair; keep the strongest
    // CRUD marker rather than letting the query order decide.
    if (crud !== null && (existing.crud === null || CRUD_ORDER.indexOf(crud) < CRUD_ORDER.indexOf(existing.crud))) {
      existing.crud = crud;
    }
  };

  for (const read of rows.reads) {
    const dataset = addDataset(s.input.table, read.dataset_namespace, read.dataset_name);
    const job = addJob(s.input.table, read.job_namespace, read.job_name);
    if (dataset && job) addEdge(dataset.id, job);
  }
  for (const write of rows.writes) {
    const job = addJob(s.output.table, write.job_namespace, write.job_name);
    const dataset = addDataset(s.output.table, write.dataset_namespace, write.dataset_name);
    if (job && dataset) addEdge(job, dataset.id, 'io', normalizeCrud(write.crud));
  }
  for (const view of rows.views) {
    const base = addDataset(s.view.table, view.base_namespace, view.base_name);
    const derived = addDataset(s.view.table, view.view_namespace, view.view_name);
    if (base && derived) addEdge(base.id, derived.id, 'view');
  }

  const columnEdges = new Map<string, ColumnEdge>();
  for (const row of rows.columnLineage) {
    if (!isIdentifier(row.input_field) || !isIdentifier(row.output_field)) {
      skip(s.columnLineage.table);
      continue;
    }
    const input = addDataset(s.columnLineage.table, row.input_namespace, row.input_dataset);
    const output = addDataset(s.columnLineage.table, row.output_namespace, row.output_dataset);
    if (!input || !output) continue;
    // Columns referenced by lineage but missing from dataset_field still get a row.
    addField(input, { name: row.input_field, type: null, description: null, required: false });
    addField(output, { name: row.output_field, type: null, description: null, required: false });
    // The producing job is optional in column lineage; a half-null pair is not a job.
    const job =
      row.job_namespace != null && row.job_name != null
        ? addJob(s.columnLineage.table, row.job_namespace, row.job_name)
        : null;
    if (job) {
      addEdge(input.id, job);
      addEdge(job, output.id);
    }
    const id = JSON.stringify([
      input.id,
      row.input_field,
      output.id,
      row.output_field,
      job,
      row.transformation_type,
      row.transformation_subtype,
      row.description,
    ]);
    if (!columnEdges.has(id)) {
      columnEdges.set(id, {
        id,
        source: input.id,
        sourceField: row.input_field,
        target: output.id,
        targetField: row.output_field,
        job,
        transformationType: row.transformation_type ?? null,
        transformationSubtype: row.transformation_subtype ?? null,
        description: row.description ?? null,
      });
    }
  }

  const warnings = [...skipped.entries()].map(([table, count]) =>
    `${count} ${count === 1 ? 'row' : 'rows'} in ${table} ${count === 1 ? 'was' : 'were'} skipped because a required namespace or name is missing.`,
  );

  return { nodes: [...nodes.values()], edges: [...edges.values()], columnEdges: [...columnEdges.values()], warnings };
}
