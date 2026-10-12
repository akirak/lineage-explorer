// Builds a small throwaway DuckDB file that matches server/schema.ts,
// so you can try the explorer before pointing it at your own database.
//   npx tsx scripts/make-sample-db.ts sample.duckdb
import { DuckDBInstance } from '@duckdb/node-api';

const file = process.argv[2] || 'sample.duckdb';
const db = await DuckDBInstance.create(file);
const c = await db.connect();

await c.run(`
  CREATE OR REPLACE TABLE job (namespace VARCHAR, name VARCHAR);
  CREATE OR REPLACE TABLE dataset (namespace VARCHAR, name VARCHAR);
  CREATE OR REPLACE TABLE run (run_id UUID, job_namespace VARCHAR, job_name VARCHAR, parent_run_id UUID);
  CREATE OR REPLACE TABLE run_event (run_id UUID, event_time TIMESTAMP, event_type VARCHAR);
  CREATE OR REPLACE TABLE input_dataset (run_id UUID, dataset_namespace VARCHAR, dataset_name VARCHAR);
  CREATE OR REPLACE TABLE output_dataset (run_id UUID, dataset_namespace VARCHAR, dataset_name VARCHAR);

  INSERT INTO job VALUES
    ('airflow', 'ingest_orders'), ('airflow', 'ingest_customers'),
    ('spark', 'build_orders_clean'), ('spark', 'build_revenue_daily'), ('dbt', 'mart_customer_ltv');
  INSERT INTO dataset VALUES
    ('postgres://prod', 'public.orders'), ('postgres://prod', 'public.customers'),
    ('s3://lake', 'raw/orders'), ('s3://lake', 'raw/customers'),
    ('s3://lake', 'clean/orders'), ('warehouse', 'marts.revenue_daily'), ('warehouse', 'marts.customer_ltv');

  INSERT INTO run VALUES
    (uuid(), 'airflow', 'ingest_orders', NULL), (uuid(), 'airflow', 'ingest_customers', NULL),
    (uuid(), 'spark', 'build_orders_clean', NULL), (uuid(), 'spark', 'build_revenue_daily', NULL),
    (uuid(), 'dbt', 'mart_customer_ltv', NULL);
`);

const runs = (await (await c.runAndReadAll(`SELECT run_id::VARCHAR AS id, job_name FROM run`)).getRowObjectsJson()) as {
  id: string;
  job_name: string;
}[];
const id: Record<string, string> = Object.fromEntries(runs.map((r) => [r.job_name, r.id]));
const states: Record<string, string> = { ingest_orders: 'COMPLETE', ingest_customers: 'COMPLETE', build_orders_clean: 'COMPLETE', build_revenue_daily: 'FAIL', mart_customer_ltv: 'RUNNING' };
let t = 0;
for (const [job, end] of Object.entries(states)) {
  await c.run(`INSERT INTO run_event VALUES ('${id[job]}', TIMESTAMP '2026-10-12 06:00:00' + INTERVAL ${t} MINUTE, 'START'), ('${id[job]}', TIMESTAMP '2026-10-12 06:00:00' + INTERVAL ${t + 4} MINUTE + INTERVAL 17 SECOND, '${end}')`);
  t += 7;
}
const io = (table: 'input_dataset' | 'output_dataset', job: string, ns: string, name: string) => c.run(`INSERT INTO ${table} VALUES ('${id[job]}', '${ns}', '${name}')`);
await io('input_dataset', 'ingest_orders', 'postgres://prod', 'public.orders');
await io('output_dataset', 'ingest_orders', 's3://lake', 'raw/orders');
await io('input_dataset', 'ingest_customers', 'postgres://prod', 'public.customers');
await io('output_dataset', 'ingest_customers', 's3://lake', 'raw/customers');
await io('input_dataset', 'build_orders_clean', 's3://lake', 'raw/orders');
await io('input_dataset', 'build_orders_clean', 's3://lake', 'raw/customers');
await io('output_dataset', 'build_orders_clean', 's3://lake', 'clean/orders');
await io('input_dataset', 'build_revenue_daily', 's3://lake', 'clean/orders');
await io('output_dataset', 'build_revenue_daily', 'warehouse', 'marts.revenue_daily');
await io('input_dataset', 'mart_customer_ltv', 's3://lake', 'clean/orders');
await io('output_dataset', 'mart_customer_ltv', 'warehouse', 'marts.customer_ltv');
console.log(`Wrote ${file}`);
