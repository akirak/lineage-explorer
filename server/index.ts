import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { DuckDBInstance, type DuckDBValue } from '@duckdb/node-api';
import type { ApiError, ColumnEdge, DatasetField, DatasetNode, Graph, LineageEdge, LineageNode } from '../shared/types.ts';
import { graphQueries } from './queries.ts';

const DB_PATH = process.env.DUCKDB_PATH || process.argv[2] || './openlineage.duckdb';
const PORT = Number(process.env.PORT || 3001);

const instance = await DuckDBInstance.create(DB_PATH, { access_mode: 'READ_ONLY' });
const conn = await instance.connect();

const all = async <T>(sql: string, params?: DuckDBValue[]): Promise<T[]> => {
  const reader = await conn.runAndReadAll(sql, params);
  return reader.getRowObjectsJson() as unknown as T[];
};

interface NameRow {
  namespace: string;
  name: string;
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

const jobId = (ns: string, name: string) => `job:${ns}\u0000${name}`;
const datasetId = (ns: string, name: string) => `dataset:${ns}\u0000${name}`;

async function buildGraph(): Promise<Graph> {
  const [jobs, datasets, reads, writes, fields, columnLineage] = await Promise.all([
    all<NameRow>(graphQueries.jobs),
    all<NameRow>(graphQueries.datasets),
    all<IoRow>(graphQueries.reads),
    all<IoRow>(graphQueries.writes),
    all<FieldRow>(graphQueries.fields),
    all<ColumnLineageRow>(graphQueries.columnLineage),
  ]);

  const nodes = new Map<string, LineageNode>();
  const addJob = (namespace: string, name: string) => {
    const id = jobId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'job', namespace, name });
    return id;
  };
  const addDataset = (namespace: string, name: string) => {
    const id = datasetId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'dataset', namespace, name, fields: [] });
    return nodes.get(id) as DatasetNode;
  };
  const addField = (dataset: DatasetNode, field: DatasetField) => {
    if (!dataset.fields.some((f) => f.name === field.name)) dataset.fields.push(field);
  };

  jobs.forEach((j) => addJob(j.namespace, j.name));
  datasets.forEach((d) => addDataset(d.namespace, d.name));
  for (const f of fields) {
    addField(addDataset(f.dataset_namespace, f.dataset_name), {
      name: f.name,
      type: f.type ?? null,
      description: f.description ?? null,
    });
  }

  const edges = new Map<string, LineageEdge>();
  const addEdge = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target });
  };

  for (const r of reads) {
    addEdge(addDataset(r.dataset_namespace, r.dataset_name).id, addJob(r.job_namespace, r.job_name));
  }
  for (const r of writes) {
    addEdge(addJob(r.job_namespace, r.job_name), addDataset(r.dataset_namespace, r.dataset_name).id);
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
  app.use('*', serveStatic({ root: fileURLToPath(new URL('../dist', import.meta.url)) }));
}

serve({ fetch: app.fetch, port: PORT }, () => console.log(`Lineage API on http://localhost:${PORT} (db: ${DB_PATH})`));
