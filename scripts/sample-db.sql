-- Builds a small throwaway DuckDB database that matches server/schema.ts,
-- so you can try the explorer before pointing it at your own database.
--   duckdb sample.duckdb < scripts/sample-db.sql

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

INSERT INTO job VALUES
  ('airflow', 'ingest_orders'),
  ('airflow', 'ingest_customers'),
  ('spark', 'build_orders_clean'),
  ('spark', 'build_revenue_daily'),
  ('dbt', 'mart_customer_ltv');

INSERT INTO dataset_field VALUES
  ('postgres://prod', 'public.orders', 'order_id', 'BIGINT', 'Primary key'),
  ('postgres://prod', 'public.orders', 'customer_id', 'BIGINT', NULL),
  ('postgres://prod', 'public.orders', 'amount', 'DECIMAL(12,2)', 'Order total in the original currency'),
  ('postgres://prod', 'public.orders', 'currency', 'VARCHAR', NULL),
  ('postgres://prod', 'public.orders', 'status', 'VARCHAR', NULL),
  ('postgres://prod', 'public.orders', 'created_at', 'TIMESTAMP', NULL),
  ('postgres://prod', 'public.customers', 'customer_id', 'BIGINT', 'Primary key'),
  ('postgres://prod', 'public.customers', 'email', 'VARCHAR', NULL),
  ('postgres://prod', 'public.customers', 'country', 'VARCHAR', NULL),
  ('postgres://prod', 'public.customers', 'signup_at', 'TIMESTAMP', NULL),
  ('s3://lake', 'raw/orders', 'order_id', 'BIGINT', NULL),
  ('s3://lake', 'raw/orders', 'customer_id', 'BIGINT', NULL),
  ('s3://lake', 'raw/orders', 'amount', 'DECIMAL(12,2)', NULL),
  ('s3://lake', 'raw/orders', 'currency', 'VARCHAR', NULL),
  ('s3://lake', 'raw/orders', 'status', 'VARCHAR', NULL),
  ('s3://lake', 'raw/orders', 'created_at', 'TIMESTAMP', NULL),
  ('s3://lake', 'raw/customers', 'customer_id', 'BIGINT', NULL),
  ('s3://lake', 'raw/customers', 'email', 'VARCHAR', NULL),
  ('s3://lake', 'raw/customers', 'country', 'VARCHAR', NULL),
  ('s3://lake', 'raw/customers', 'signup_at', 'TIMESTAMP', NULL),
  ('s3://lake', 'clean/orders', 'order_id', 'BIGINT', NULL),
  ('s3://lake', 'clean/orders', 'customer_id', 'BIGINT', NULL),
  ('s3://lake', 'clean/orders', 'customer_country', 'VARCHAR', NULL),
  ('s3://lake', 'clean/orders', 'amount_usd', 'DECIMAL(12,2)', 'Amount converted to USD'),
  ('s3://lake', 'clean/orders', 'order_date', 'DATE', NULL),
  ('warehouse', 'marts.revenue_daily', 'order_date', 'DATE', NULL),
  ('warehouse', 'marts.revenue_daily', 'country', 'VARCHAR', NULL),
  ('warehouse', 'marts.revenue_daily', 'revenue_usd', 'DECIMAL(14,2)', NULL),
  ('warehouse', 'marts.revenue_daily', 'order_count', 'BIGINT', NULL),
  ('warehouse', 'marts.customer_ltv', 'customer_id', 'BIGINT', NULL),
  ('warehouse', 'marts.customer_ltv', 'country', 'VARCHAR', NULL),
  ('warehouse', 'marts.customer_ltv', 'lifetime_value_usd', 'DECIMAL(14,2)', NULL),
  ('warehouse', 'marts.customer_ltv', 'first_order_date', 'DATE', NULL);

INSERT INTO dataset
SELECT DISTINCT dataset_namespace, dataset_name FROM dataset_field;

INSERT INTO job_input VALUES
  ('airflow', 'ingest_orders', 'postgres://prod', 'public.orders'),
  ('airflow', 'ingest_customers', 'postgres://prod', 'public.customers'),
  ('spark', 'build_orders_clean', 's3://lake', 'raw/orders'),
  ('spark', 'build_orders_clean', 's3://lake', 'raw/customers'),
  ('spark', 'build_revenue_daily', 's3://lake', 'clean/orders'),
  ('dbt', 'mart_customer_ltv', 's3://lake', 'clean/orders');

INSERT INTO job_output VALUES
  ('airflow', 'ingest_orders', 's3://lake', 'raw/orders'),
  ('airflow', 'ingest_customers', 's3://lake', 'raw/customers'),
  ('spark', 'build_orders_clean', 's3://lake', 'clean/orders'),
  ('spark', 'build_revenue_daily', 'warehouse', 'marts.revenue_daily'),
  ('dbt', 'mart_customer_ltv', 'warehouse', 'marts.customer_ltv');

-- Ingest jobs copy every column unchanged.
INSERT INTO column_lineage
SELECT o.job_namespace, o.job_name,
       i.dataset_namespace, i.dataset_name, f.field_name,
       o.dataset_namespace, o.dataset_name, f.field_name,
       'DIRECT', 'IDENTITY'
FROM job_input i
JOIN job_output o USING (job_namespace, job_name)
JOIN dataset_field f ON f.dataset_namespace = i.dataset_namespace AND f.dataset_name = i.dataset_name
WHERE i.job_namespace = 'airflow';

INSERT INTO column_lineage VALUES
  ('spark', 'build_orders_clean', 's3://lake', 'raw/orders', 'order_id', 's3://lake', 'clean/orders', 'order_id', 'DIRECT', 'IDENTITY'),
  ('spark', 'build_orders_clean', 's3://lake', 'raw/orders', 'customer_id', 's3://lake', 'clean/orders', 'customer_id', 'DIRECT', 'IDENTITY'),
  ('spark', 'build_orders_clean', 's3://lake', 'raw/customers', 'country', 's3://lake', 'clean/orders', 'customer_country', 'DIRECT', 'IDENTITY'),
  ('spark', 'build_orders_clean', 's3://lake', 'raw/customers', 'customer_id', 's3://lake', 'clean/orders', 'customer_country', 'INDIRECT', 'JOIN'),
  ('spark', 'build_orders_clean', 's3://lake', 'raw/orders', 'amount', 's3://lake', 'clean/orders', 'amount_usd', 'DIRECT', 'TRANSFORMATION'),
  ('spark', 'build_orders_clean', 's3://lake', 'raw/orders', 'currency', 's3://lake', 'clean/orders', 'amount_usd', 'DIRECT', 'TRANSFORMATION'),
  ('spark', 'build_orders_clean', 's3://lake', 'raw/orders', 'created_at', 's3://lake', 'clean/orders', 'order_date', 'DIRECT', 'TRANSFORMATION'),
  ('spark', 'build_orders_clean', 's3://lake', 'raw/orders', 'status', 's3://lake', 'clean/orders', 'order_id', 'INDIRECT', 'FILTER'),

  ('spark', 'build_revenue_daily', 's3://lake', 'clean/orders', 'order_date', 'warehouse', 'marts.revenue_daily', 'order_date', 'DIRECT', 'IDENTITY'),
  ('spark', 'build_revenue_daily', 's3://lake', 'clean/orders', 'customer_country', 'warehouse', 'marts.revenue_daily', 'country', 'DIRECT', 'IDENTITY'),
  ('spark', 'build_revenue_daily', 's3://lake', 'clean/orders', 'amount_usd', 'warehouse', 'marts.revenue_daily', 'revenue_usd', 'DIRECT', 'AGGREGATION'),
  ('spark', 'build_revenue_daily', 's3://lake', 'clean/orders', 'order_id', 'warehouse', 'marts.revenue_daily', 'order_count', 'DIRECT', 'AGGREGATION'),
  ('spark', 'build_revenue_daily', 's3://lake', 'clean/orders', 'order_date', 'warehouse', 'marts.revenue_daily', 'revenue_usd', 'INDIRECT', 'GROUP_BY'),
  ('spark', 'build_revenue_daily', 's3://lake', 'clean/orders', 'customer_country', 'warehouse', 'marts.revenue_daily', 'revenue_usd', 'INDIRECT', 'GROUP_BY'),

  ('dbt', 'mart_customer_ltv', 's3://lake', 'clean/orders', 'customer_id', 'warehouse', 'marts.customer_ltv', 'customer_id', 'DIRECT', 'IDENTITY'),
  ('dbt', 'mart_customer_ltv', 's3://lake', 'clean/orders', 'customer_country', 'warehouse', 'marts.customer_ltv', 'country', 'DIRECT', 'IDENTITY'),
  ('dbt', 'mart_customer_ltv', 's3://lake', 'clean/orders', 'amount_usd', 'warehouse', 'marts.customer_ltv', 'lifetime_value_usd', 'DIRECT', 'AGGREGATION'),
  ('dbt', 'mart_customer_ltv', 's3://lake', 'clean/orders', 'order_date', 'warehouse', 'marts.customer_ltv', 'first_order_date', 'DIRECT', 'AGGREGATION'),
  ('dbt', 'mart_customer_ltv', 's3://lake', 'clean/orders', 'customer_id', 'warehouse', 'marts.customer_ltv', 'lifetime_value_usd', 'INDIRECT', 'GROUP_BY');
