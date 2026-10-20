// ---------------------------------------------------------------------------
// Data access for the lineage explorer.
//
// The API used to live in this folder as a Hono server that opened a DuckDB
// file. It now runs as TanStack Start server routes (`src/routes/api/*`), and
// this module owns the database work they call into.
//
// A database is a parquet file produced by the `rebuild-db` Vite plugin. One
// parquet file can only hold one table, so every source table is stacked into a
// single long table:
//
//   table_name VARCHAR, data JSON
//
// When such a file is opened, a view is created for each table the explorer
// knows about (`server/schema.ts`) by extracting the columns out of `data`.
// The rest of the server can then query those views exactly as if they were
// regular tables.
//
// For convenience a plain `.duckdb` file (for example the one produced by
// `duckdb sample.duckdb < data/build-db.sql`) is still supported through
// `DUCKDB_PATH`.
// ---------------------------------------------------------------------------
import '@tanstack/react-start/server-only';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';
import type { ColumnEdge, DatabaseInfo, DatasetField, DatasetNode, Graph, LineageEdge, LineageNode } from '../shared/types.ts';
import { graphQueries, type AvailableColumns } from './queries.ts';
import { schema as s } from './schema.ts';

const ROOT = process.cwd();

/** Directory scanned for generated parquet databases. */
const BUILDS_DIR = path.resolve(ROOT, process.env.LINEAGE_DB_DIR ?? 'builds');

/** Optional legacy single-file database. */
const ENV_DB = process.env.DUCKDB_PATH ? path.resolve(ROOT, process.env.DUCKDB_PATH) : undefined;

const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`;
const quoteString = (value: string) => `'${value.replace(/'/g, "''")}'`;
const jsonPath = (key: string) => `$."${key.replace(/"/g, '""')}"`;

/** Tables the explorer reads, mapped to every column `server/schema.ts` uses. */
function schemaTables(): Map<string, string[]> {
  const tables = new Map<string, Set<string>>();
  for (const entity of Object.values(s)) {
    const table = entity.table;
    const columns = tables.get(table) ?? new Set<string>();
    for (const [key, value] of Object.entries(entity)) {
      if (key !== 'table') columns.add(value);
    }
    tables.set(table, columns);
  }
  return new Map([...tables].map(([table, columns]) => [table, [...columns]]));
}

/** SQL that turns the stacked parquet rows for one table into a typed view. */
function viewSql(table: string, columns: string[], file: string): string {
  const selects = columns
    .map((column) => `json_extract_string("data", ${quoteString(jsonPath(column))}) AS ${quoteIdent(column)}`)
    .join(', ');
  return `CREATE OR REPLACE VIEW ${quoteIdent(table)} AS SELECT ${selects} FROM read_parquet(${quoteString(file)}) WHERE "table_name" = ${quoteString(table)}`;
}

const tableColumns = async (conn: DuckDBConnection, table: string): Promise<Set<string>> => {
  const reader = await conn.runAndReadAll(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'main' AND table_name = ?`,
    [table],
  );
  return new Set(reader.getRowObjectsJson().map((row) => row.column_name as string));
};

const loadAvailableColumns = async (conn: DuckDBConnection): Promise<AvailableColumns> => ({
  job: await tableColumns(conn, s.job.table),
  dataset: await tableColumns(conn, s.dataset.table),
});

interface LoadedDatabase {
  path: string;
  mtimeMs: number;
  instance: DuckDBInstance;
  conn: DuckDBConnection;
  queries: ReturnType<typeof graphQueries>;
}

const openParquet = async (file: string, mtimeMs: number): Promise<LoadedDatabase> => {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  for (const [table, columns] of schemaTables()) {
    await conn.run(viewSql(table, columns, file));
  }
  const availableColumns = await loadAvailableColumns(conn);
  return { path: file, mtimeMs, instance, conn, queries: graphQueries(availableColumns) };
};

const openDuckDb = async (file: string, mtimeMs: number): Promise<LoadedDatabase> => {
  const instance = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' });
  const conn = await instance.connect();
  const availableColumns = await loadAvailableColumns(conn);
  return { path: file, mtimeMs, instance, conn, queries: graphQueries(availableColumns) };
};

const cache = new Map<string, LoadedDatabase>();
const opening = new Map<string, Promise<LoadedDatabase>>();

/** Open (or reuse) a database file, reopening it when its mtime changes. */
async function getDatabase(file: string): Promise<LoadedDatabase> {
  const info = await stat(file);
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs) return cached;

  const pending = opening.get(file);
  if (pending) return pending;

  const load = (async () => {
    if (cached) {
      cached.instance.closeSync();
      cache.delete(file);
    }
    const loaded = file.endsWith('.parquet')
      ? await openParquet(file, info.mtimeMs)
      : await openDuckDb(file, info.mtimeMs);
    cache.set(file, loaded);
    return loaded;
  })().finally(() => opening.delete(file));

  opening.set(file, load);
  return load;
}

const databasePath = (id: string): string | undefined => {
  if (ENV_DB) return path.basename(ENV_DB) === id ? ENV_DB : undefined;
  // Database ids are file names; reject anything that tries to escape the dir.
  if (path.basename(id) !== id) return undefined;
  return path.join(BUILDS_DIR, id);
};

/** Every database file the explorer can serve, newest first. */
export async function listDatabases(): Promise<DatabaseInfo[]> {
  if (ENV_DB) {
    try {
      const info = await stat(ENV_DB);
      return [{ id: path.basename(ENV_DB), builtAt: info.mtimeMs }];
    } catch {
      return [];
    }
  }

  const entries = await readdir(BUILDS_DIR, { withFileTypes: true }).catch(() => []);
  const databases: DatabaseInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.parquet')) continue;
    const info = await stat(path.join(BUILDS_DIR, entry.name));
    databases.push({ id: entry.name, builtAt: info.mtimeMs });
  }
  return databases.sort((a, b) => b.builtAt - a.builtAt);
}

/** The database selected by the cookie, falling back to the newest one. */
export async function currentDatabaseId(cookieId?: string): Promise<string | undefined> {
  const databases = await listDatabases();
  if (databases.length === 0) return undefined;
  if (cookieId && databases.some((database) => database.id === cookieId)) return cookieId;
  return databases[0].id;
}

const all = async <T>(conn: DuckDBConnection, sql: string, params?: DuckDBValue[]): Promise<T[]> => {
  const reader = await conn.runAndReadAll(sql, params);
  return reader.getRowObjectsJson() as unknown as T[];
};

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

async function graphFromDatabase(database: LoadedDatabase): Promise<Graph> {
  const { conn, queries } = database;
  const [jobs, datasets, reads, writes, fields, columnLineage, views] = await Promise.all([
    all<NameRow>(conn, queries.jobs),
    all<NameRow>(conn, queries.datasets),
    all<IoRow>(conn, queries.reads),
    all<IoRow>(conn, queries.writes),
    all<FieldRow>(conn, queries.fields),
    all<ColumnLineageRow>(conn, queries.columnLineage),
    all<ViewRow>(conn, queries.views),
  ]);

  const nodes = new Map<string, LineageNode>();
  const addJob = (
    namespace: string,
    name: string,
    title: string | null = null,
    description: string | null = null,
    archetype: string | null = null,
  ) => {
    const id = jobId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'job', namespace, name, title, description, archetype });
    return id;
  };
  const addDataset = (
    namespace: string,
    name: string,
    title: string | null = null,
    description: string | null = null,
    archetype: string | null = null,
  ) => {
    const id = datasetId(namespace, name);
    if (!nodes.has(id)) nodes.set(id, { id, type: 'dataset', namespace, name, title, description, archetype, fields: [] });
    return nodes.get(id) as DatasetNode;
  };
  const addField = (dataset: DatasetNode, field: DatasetField) => {
    if (!dataset.fields.some((f) => f.name === field.name)) dataset.fields.push(field);
  };

  jobs.forEach((job) => addJob(job.namespace, job.name, job.title, job.description, job.archetype));
  datasets.forEach((dataset) => addDataset(dataset.namespace, dataset.name, dataset.title, dataset.description, dataset.archetype));
  for (const field of fields) {
    addField(addDataset(field.dataset_namespace, field.dataset_name), {
      name: field.name,
      type: field.type ?? null,
      description: field.description ?? null,
    });
  }

  const edges = new Map<string, LineageEdge>();
  const addEdge = (source: string, target: string, kind: 'io' | 'view' = 'io') => {
    const id = `${source}->${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target, kind });
  };

  for (const read of reads) {
    addEdge(addDataset(read.dataset_namespace, read.dataset_name).id, addJob(read.job_namespace, read.job_name));
  }
  for (const write of writes) {
    addEdge(addJob(write.job_namespace, write.job_name), addDataset(write.dataset_namespace, write.dataset_name).id);
  }
  for (const view of views) {
    addEdge(addDataset(view.base_namespace, view.base_name).id, addDataset(view.view_namespace, view.view_name).id, 'view');
  }

  const columnEdges = new Map<string, ColumnEdge>();
  for (const row of columnLineage) {
    const input = addDataset(row.input_namespace, row.input_dataset);
    const output = addDataset(row.output_namespace, row.output_dataset);
    // Columns referenced by lineage but missing from dataset_field still get a row.
    addField(input, { name: row.input_field, type: null, description: null });
    addField(output, { name: row.output_field, type: null, description: null });
    const job = row.job_namespace != null && row.job_name != null ? addJob(row.job_namespace, row.job_name) : null;
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
      });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], columnEdges: [...columnEdges.values()] };
}

/** Build the full lineage graph for the database selected by the cookie. */
export async function buildGraph(cookieId?: string): Promise<Graph> {
  const id = await currentDatabaseId(cookieId);
  if (!id) throw new Error('No database found. Start the dev server or build a parquet file first.');
  const file = databasePath(id);
  if (!file) throw new Error(`Unknown database: ${id}`);
  return graphFromDatabase(await getDatabase(file));
}
