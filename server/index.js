import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { graphQueries, jobRunsQuery } from './queries.js';

const DB_PATH = process.env.DUCKDB_PATH || process.argv[2] || './openlineage.duckdb';
const PORT = Number(process.env.PORT || 3001);

const instance = await DuckDBInstance.create(DB_PATH, { access_mode: 'READ_ONLY' });
const conn = await instance.connect();

const all = async (sql, params) => {
  const reader = params ? await conn.runAndReadAll(sql, params) : await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson();
};

const jobId = (ns, name) => `job:${ns}\u0000${name}`;
const datasetId = (ns, name) => `dataset:${ns}\u0000${name}`;

async function buildGraph() {
  const [jobs, datasets, reads, writes] = await Promise.all([
    all(graphQueries.jobs),
    all(graphQueries.datasets),
    all(graphQueries.reads),
    all(graphQueries.writes),
  ]);

  const nodes = new Map();
  const addJob = (namespace, name, extra = {}) => {
    const id = jobId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'job', namespace, name, state: null, lastEventTime: null, ...extra });
    return id;
  };
  const addDataset = (namespace, name) => {
    const id = datasetId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'dataset', namespace, name });
    return id;
  };

  jobs.forEach((j) => addJob(j.namespace, j.name, { state: j.state ?? null, lastEventTime: j.last_event_time ?? null }));
  datasets.forEach((d) => addDataset(d.namespace, d.name));

  const edges = new Map();
  const addEdge = (source, target) => {
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

const app = express();

app.get('/api/graph', async (_req, res) => {
  try {
    res.json(await buildGraph());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/job-runs', async (req, res) => {
  const { namespace, name } = req.query;
  if (!namespace || !name) return res.status(400).json({ error: 'namespace and name are required' });
  try {
    res.json(await all(jobRunsQuery, [String(namespace), String(name)]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(dist));
}

app.listen(PORT, () => console.log(`Lineage API on http://localhost:${PORT} (db: ${DB_PATH})`));
