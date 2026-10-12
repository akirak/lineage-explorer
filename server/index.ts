import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { DuckDBInstance, type DuckDBValue } from '@duckdb/node-api';
import type { ApiError, Graph, JobNode, JobRun, LineageEdge, LineageNode } from '../shared/types.ts';
import { graphQueries, jobRunsQuery } from './queries.ts';

const DB_PATH = process.env.DUCKDB_PATH || process.argv[2] || './openlineage.duckdb';
const PORT = Number(process.env.PORT || 3001);

const instance = await DuckDBInstance.create(DB_PATH, { access_mode: 'READ_ONLY' });
const conn = await instance.connect();

const all = async <T>(sql: string, params?: DuckDBValue[]): Promise<T[]> => {
  const reader = await conn.runAndReadAll(sql, params);
  return reader.getRowObjectsJson() as unknown as T[];
};

interface JobRow {
  namespace: string;
  name: string;
  state: string | null;
  last_event_time: string | null;
}

interface DatasetRow {
  namespace: string;
  name: string;
}

interface IoRow {
  dataset_namespace: string;
  dataset_name: string;
  job_namespace: string;
  job_name: string;
}

const jobId = (ns: string, name: string) => `job:${ns}\u0000${name}`;
const datasetId = (ns: string, name: string) => `dataset:${ns}\u0000${name}`;

async function buildGraph(): Promise<Graph> {
  const [jobs, datasets, reads, writes] = await Promise.all([
    all<JobRow>(graphQueries.jobs),
    all<DatasetRow>(graphQueries.datasets),
    all<IoRow>(graphQueries.reads),
    all<IoRow>(graphQueries.writes),
  ]);

  const nodes = new Map<string, LineageNode>();
  const addJob = (namespace: string, name: string, extra: Partial<Pick<JobNode, 'state' | 'lastEventTime'>> = {}) => {
    const id = jobId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'job', namespace, name, state: null, lastEventTime: null, ...extra });
    return id;
  };
  const addDataset = (namespace: string, name: string) => {
    const id = datasetId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'dataset', namespace, name });
    return id;
  };

  jobs.forEach((j) => addJob(j.namespace, j.name, { state: j.state ?? null, lastEventTime: j.last_event_time ?? null }));
  datasets.forEach((d) => addDataset(d.namespace, d.name));

  const edges = new Map<string, LineageEdge>();
  const addEdge = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target });
  };

  for (const r of reads) {
    addEdge(addDataset(r.dataset_namespace, r.dataset_name), addJob(r.job_namespace, r.job_name));
  }
  for (const r of writes) {
    addEdge(addJob(r.job_namespace, r.job_name), addDataset(r.dataset_namespace, r.dataset_name));
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

const app = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json<ApiError>({ error: err.message || String(err) }, 500);
});

app.get('/api/graph', async (c) => c.json(await buildGraph()));

app.get('/api/job-runs', async (c) => {
  const namespace = c.req.query('namespace');
  const name = c.req.query('name');
  if (!namespace || !name) return c.json<ApiError>({ error: 'namespace and name are required' }, 400);
  return c.json(await all<JobRun>(jobRunsQuery, [namespace, name]));
});

if (process.env.NODE_ENV === 'production') {
  app.use('*', serveStatic({ root: fileURLToPath(new URL('../dist', import.meta.url)) }));
}

serve({ fetch: app.fetch, port: PORT }, () => console.log(`Lineage API on http://localhost:${PORT} (db: ${DB_PATH})`));
