// Builds a small throwaway DuckDB file that matches server/schema.ts,
// so you can try the explorer before pointing it at your own database.
//   npx tsx scripts/make-sample-db.ts sample.duckdb
import { DuckDBInstance } from '@duckdb/node-api';

const file = process.argv[2] || 'sample.duckdb';
const db = await DuckDBInstance.create(file);
const c = await db.connect();

await c.run(`
  DROP TABLE IF EXISTS run; DROP TABLE IF EXISTS run_event;
  DROP TABLE IF EXISTS input_dataset; DROP TABLE IF EXISTS output_dataset;
  CREATE OR REPLACE TABLE job (namespace VARCHAR, name VARCHAR);
  CREATE OR REPLACE TABLE dataset (namespace VARCHAR, name VARCHAR);
  CREATE OR REPLACE TABLE job_input (job_namespace VARCHAR, job_name VARCHAR, dataset_namespace VARCHAR, dataset_name VARCHAR);
  CREATE OR REPLACE TABLE job_output (job_namespace VARCHAR, job_name VARCHAR, dataset_namespace VARCHAR, dataset_name VARCHAR);
  CREATE OR REPLACE TABLE dataset_field (dataset_namespace VARCHAR, dataset_name VARCHAR, field_name VARCHAR, field_type VARCHAR, description VARCHAR);
  CREATE OR REPLACE TABLE column_lineage (
    job_namespace VARCHAR, job_name VARCHAR,
    input_dataset_namespace VARCHAR, input_dataset_name VARCHAR, input_field VARCHAR,
    output_dataset_namespace VARCHAR, output_dataset_name VARCHAR, output_field VARCHAR,
    transformation_type VARCHAR, transformation_subtype VARCHAR
  );
`);

const PG = 'postgres://prod';
const S3 = 's3://lake';
const WH = 'warehouse';

const jobs: [string, string][] = [
  ['airflow', 'ingest_orders'],
  ['airflow', 'ingest_customers'],
  ['spark', 'build_orders_clean'],
  ['spark', 'build_revenue_daily'],
  ['dbt', 'mart_customer_ltv'],
];

// [namespace, dataset, [field, type, description?][]]
const datasets: [string, string, [string, string, string?][]][] = [
  [PG, 'public.orders', [['order_id', 'BIGINT', 'Primary key'], ['customer_id', 'BIGINT'], ['amount', 'DECIMAL(12,2)', 'Order total in the original currency'], ['currency', 'VARCHAR'], ['status', 'VARCHAR'], ['created_at', 'TIMESTAMP']]],
  [PG, 'public.customers', [['customer_id', 'BIGINT', 'Primary key'], ['email', 'VARCHAR'], ['country', 'VARCHAR'], ['signup_at', 'TIMESTAMP']]],
  [S3, 'raw/orders', [['order_id', 'BIGINT'], ['customer_id', 'BIGINT'], ['amount', 'DECIMAL(12,2)'], ['currency', 'VARCHAR'], ['status', 'VARCHAR'], ['created_at', 'TIMESTAMP']]],
  [S3, 'raw/customers', [['customer_id', 'BIGINT'], ['email', 'VARCHAR'], ['country', 'VARCHAR'], ['signup_at', 'TIMESTAMP']]],
  [S3, 'clean/orders', [['order_id', 'BIGINT'], ['customer_id', 'BIGINT'], ['customer_country', 'VARCHAR'], ['amount_usd', 'DECIMAL(12,2)', 'Amount converted to USD'], ['order_date', 'DATE']]],
  [WH, 'marts.revenue_daily', [['order_date', 'DATE'], ['country', 'VARCHAR'], ['revenue_usd', 'DECIMAL(14,2)'], ['order_count', 'BIGINT']]],
  [WH, 'marts.customer_ltv', [['customer_id', 'BIGINT'], ['country', 'VARCHAR'], ['lifetime_value_usd', 'DECIMAL(14,2)'], ['first_order_date', 'DATE']]],
];

const sql = (v: string | null | undefined) => (v == null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
const insert = (table: string, rows: (string | null | undefined)[][]) =>
  c.run(`INSERT INTO ${table} VALUES ${rows.map((r) => `(${r.map(sql).join(', ')})`).join(', ')}`);

await insert('job', jobs);
await insert('dataset', datasets.map(([ns, name]) => [ns, name]));
await insert('dataset_field', datasets.flatMap(([ns, name, fields]) => fields.map(([f, t, d]) => [ns, name, f, t, d])));

type Ref = [string, string];
const io: [Ref, Ref[], Ref[]][] = [
  [['airflow', 'ingest_orders'], [[PG, 'public.orders']], [[S3, 'raw/orders']]],
  [['airflow', 'ingest_customers'], [[PG, 'public.customers']], [[S3, 'raw/customers']]],
  [['spark', 'build_orders_clean'], [[S3, 'raw/orders'], [S3, 'raw/customers']], [[S3, 'clean/orders']]],
  [['spark', 'build_revenue_daily'], [[S3, 'clean/orders']], [[WH, 'marts.revenue_daily']]],
  [['dbt', 'mart_customer_ltv'], [[S3, 'clean/orders']], [[WH, 'marts.customer_ltv']]],
];
await insert('job_input', io.flatMap(([job, inputs]) => inputs.map((d) => [...job, ...d])));
await insert('job_output', io.flatMap(([job, , outputs]) => outputs.map((d) => [...job, ...d])));

// [job, input dataset, input field, output dataset, output field, type, subtype]
type Lineage = [Ref, Ref, string, Ref, string, 'DIRECT' | 'INDIRECT', string];
const lineage: Lineage[] = [];
const identity = (job: Ref, from: Ref, to: Ref, fields: string[]) =>
  fields.forEach((f) => lineage.push([job, from, f, to, f, 'DIRECT', 'IDENTITY']));

identity(['airflow', 'ingest_orders'], [PG, 'public.orders'], [S3, 'raw/orders'], ['order_id', 'customer_id', 'amount', 'currency', 'status', 'created_at']);
identity(['airflow', 'ingest_customers'], [PG, 'public.customers'], [S3, 'raw/customers'], ['customer_id', 'email', 'country', 'signup_at']);

const clean: Ref = ['spark', 'build_orders_clean'];
const rawOrders: Ref = [S3, 'raw/orders'];
const rawCustomers: Ref = [S3, 'raw/customers'];
const cleanOrders: Ref = [S3, 'clean/orders'];
identity(clean, rawOrders, cleanOrders, ['order_id', 'customer_id']);
lineage.push(
  [clean, rawCustomers, 'country', cleanOrders, 'customer_country', 'DIRECT', 'IDENTITY'],
  [clean, rawCustomers, 'customer_id', cleanOrders, 'customer_country', 'INDIRECT', 'JOIN'],
  [clean, rawOrders, 'amount', cleanOrders, 'amount_usd', 'DIRECT', 'TRANSFORMATION'],
  [clean, rawOrders, 'currency', cleanOrders, 'amount_usd', 'DIRECT', 'TRANSFORMATION'],
  [clean, rawOrders, 'created_at', cleanOrders, 'order_date', 'DIRECT', 'TRANSFORMATION'],
  [clean, rawOrders, 'status', cleanOrders, 'order_id', 'INDIRECT', 'FILTER'],
);

const revenue: Ref = ['spark', 'build_revenue_daily'];
const revenueDaily: Ref = [WH, 'marts.revenue_daily'];
lineage.push(
  [revenue, cleanOrders, 'order_date', revenueDaily, 'order_date', 'DIRECT', 'IDENTITY'],
  [revenue, cleanOrders, 'customer_country', revenueDaily, 'country', 'DIRECT', 'IDENTITY'],
  [revenue, cleanOrders, 'amount_usd', revenueDaily, 'revenue_usd', 'DIRECT', 'AGGREGATION'],
  [revenue, cleanOrders, 'order_id', revenueDaily, 'order_count', 'DIRECT', 'AGGREGATION'],
  [revenue, cleanOrders, 'order_date', revenueDaily, 'revenue_usd', 'INDIRECT', 'GROUP_BY'],
  [revenue, cleanOrders, 'customer_country', revenueDaily, 'revenue_usd', 'INDIRECT', 'GROUP_BY'],
);

const ltv: Ref = ['dbt', 'mart_customer_ltv'];
const customerLtv: Ref = [WH, 'marts.customer_ltv'];
lineage.push(
  [ltv, cleanOrders, 'customer_id', customerLtv, 'customer_id', 'DIRECT', 'IDENTITY'],
  [ltv, cleanOrders, 'customer_country', customerLtv, 'country', 'DIRECT', 'IDENTITY'],
  [ltv, cleanOrders, 'amount_usd', customerLtv, 'lifetime_value_usd', 'DIRECT', 'AGGREGATION'],
  [ltv, cleanOrders, 'order_date', customerLtv, 'first_order_date', 'DIRECT', 'AGGREGATION'],
  [ltv, cleanOrders, 'customer_id', customerLtv, 'lifetime_value_usd', 'INDIRECT', 'GROUP_BY'],
);

await insert(
  'column_lineage',
  lineage.map(([job, from, ff, to, tf, type, subtype]) => [...job, ...from, ff, ...to, tf, type, subtype]),
);
console.log(`Wrote ${file}`);
