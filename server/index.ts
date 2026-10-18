import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { DuckDBInstance, type DuckDBValue } from '@duckdb/node-api';
import type { ApiError, ColumnEdge, DatasetField, DatasetNode, Graph, LineageEdge, LineageNode } from '../shared/types.ts';
import { graphQueries } from './queries.ts';
import { schema as s } from './schema.ts';

const DB_PATH = process.env.DUCKDB_PATH || process.argv[2] || './openlineage.duckdb';
const PORT = Number(process.env.PORT || 3001);

const instance = await DuckDBInstance.create(DB_PATH, { access_mode: 'READ_ONLY' });
const conn = await instance.connect();

const all = async <T>(sql: string, params?: DuckDBValue[]): Promise<T[]> => {
  const reader = await conn.runAndReadAll(sql, params);
  return reader.getRowObjectsJson() as unknown as T[];
};

const tableColumns = async (table: string): Promise<Set<string>> => {
  const rows = await all<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'main' AND table_name = ?`,
    [table],
  );
  return new Set(rows.map((r) => r.column_name));
};

// Optional title/description columns are selected only when they exist.
const availableColumns = {
  job: await tableColumns(s.job.table),
  dataset: await tableColumns(s.dataset.table),
};

const queries = graphQueries(availableColumns);

interface NameRow {
  namespace: string;
  name: string;
  title: string | null;
  description: string | null;
  archetype: string | null;
}

interface IoRow {
  dataset_namespace: string;
  dataset_name: string;
  job_namespace: string;
  job_name: string;
}

interface FieldRow extends DatasetField {
  dataset_namespace: string;
  dataset_name: string;
}

interface ColumnLineageRow {
  job_namespace: string | null;
  job_name: string | null;
  input_namespace: string;
  input_dataset: string;
  input_field: string;
  output_namespace: string;
  output_dataset: string;
  output_field: string;
  transformation_type: string | null;
  transformation_subtype: string | null;
}

interface ViewRow {
  view_namespace: string;
  view_name: string;
  base_namespace: string;
  base_name: string;
}

const jobId = (ns: string, name: string) => `job:${ns}\u0000${name}`;
const datasetId = (ns: string, name: string) => `dataset:${ns}\u0000${name}`;

async function buildGraph(): Promise<Graph> {
  const [jobs, datasets, reads, writes, fields, columnLineage, views] = await Promise.all([
    all<NameRow>(queries.jobs),
    all<NameRow>(queries.datasets),
    all<IoRow>(queries.reads),
    all<IoRow>(queries.writes),
    all<FieldRow>(queries.fields),
    all<ColumnLineageRow>(queries.columnLineage),
    all<ViewRow>(queries.views),
  ]);

  const nodes = new Map<string, LineageNode>();
  const addJob = (namespace: string, name: string, title: string | null = null, description: string | null = null, archetype: string | null = null) => {
    const id = jobId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'job', namespace, name, title, description, archetype });
    return id;
  };
  const addDataset = (namespace: string, name: string, title: string | null = null, description: string | null = null, archetype: string | null = null) => {
    const id = datasetId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'dataset', namespace, name, title, description, archetype, fields: [] });
    return nodes.get(id) as DatasetNode;
  };
  const addField = (dataset: DatasetNode, field: DatasetField) => {
    if (!dataset.fields.some((f) => f.name === field.name)) dataset.fields.push(field);
  };

  jobs.forEach((j) => addJob(j.namespace, j.name, j.title, j.description, j.archetype));
  datasets.forEach((d) => addDataset(d.namespace, d.name, d.title, d.description, d.archetype));
  for (const f of fields) {
    addField(addDataset(f.dataset_namespace, f.dataset_name), {
      name: f.name,
      type: f.type ?? null,
      description: f.description ?? null,
    });
  }

  const edges = new Map<string, LineageEdge>();
  const addEdge = (source: string, target: string, kind: 'io' | 'view' = 'io') => {
    const id = `${source}->${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target, kind });
  };

  for (const r of reads) {
    addEdge(addDataset(r.dataset_namespace, r.dataset_name).id, addJob(r.job_namespace, r.job_name));
  }
  for (const r of writes) {
    addEdge(addJob(r.job_namespace, r.job_name), addDataset(r.dataset_namespace, r.dataset_name).id);
  }
  for (const v of views) {
    addEdge(addDataset(v.base_namespace, v.base_name).id, addDataset(v.view_namespace, v.view_name).id, 'view');
  }

  const columnEdges = new Map<string, ColumnEdge>();
  for (const r of columnLineage) {
    const input = addDataset(r.input_namespace, r.input_dataset);
    const output = addDataset(r.output_namespace, r.output_dataset);
    // Columns referenced by lineage but missing from dataset_field still get a row.
    addField(input, { name: r.input_field, type: null, description: null });
    addField(output, { name: r.output_field, type: null, description: null });
    const job = r.job_namespace != null && r.job_name != null ? addJob(r.job_namespace, r.job_name) : null;
    if (job) {
      addEdge(input.id, job);
      addEdge(job, output.id);
    }
    const id = JSON.stringify([input.id, r.input_field, output.id, r.output_field, job, r.transformation_type, r.transformation_subtype]);
    if (!columnEdges.has(id)) {
      columnEdges.set(id, {
        id,
        source: input.id,
        sourceField: r.input_field,
        target: output.id,
        targetField: r.output_field,
        job,
        transformationType: r.transformation_type ?? null,
        transformationSubtype: r.transformation_subtype ?? null,
      });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], columnEdges: [...columnEdges.values()] };
}

const app = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json<ApiError>({ error: err.message || String(err) }, 500);
});

app.get('/api/graph', async (c) => c.json(await buildGraph()));

if (process.env.NODE_ENV === 'production') {
  const distRoot = fileURLToPath(new URL('../dist', import.meta.url));
  const indexHtml = readFileSync(join(distRoot, 'index.html'), 'utf8');
  app.use('*', serveStatic({ root: distRoot }));
  // Client-side routes (e.g. /nodes) have no file on disk; serve the app shell.
  app.notFound((c) =>
    c.req.path.startsWith('/api/') ? c.json<ApiError>({ error: 'Not found' }, 404) : c.html(indexHtml),
  );
}

serve({ fetch: app.fetch, port: PORT }, () => console.log(`Lineage API on http://localhost:${PORT} (db: ${DB_PATH})`));
