-- Builds a small throwaway DuckDB database that matches server/schema.ts,
-- so you can try the explorer before pointing it at your own database.
--   duckdb sample.duckdb < data/build-db.sql

CREATE OR REPLACE TABLE job (namespace VARCHAR, name VARCHAR, title VARCHAR, description VARCHAR, archetype VARCHAR);
CREATE OR REPLACE TABLE dataset (namespace VARCHAR, name VARCHAR, title VARCHAR, description VARCHAR, archetype VARCHAR);
CREATE OR REPLACE TABLE job_input (job_namespace VARCHAR, job_name VARCHAR, dataset_namespace VARCHAR, dataset_name VARCHAR);
CREATE OR REPLACE TABLE job_output (job_namespace VARCHAR, job_name VARCHAR, dataset_namespace VARCHAR, dataset_name VARCHAR);
CREATE OR REPLACE TABLE dataset_field (dataset_namespace VARCHAR, dataset_name VARCHAR, field_name VARCHAR, field_type VARCHAR, description VARCHAR);
CREATE OR REPLACE TABLE column_lineage (
  job_namespace VARCHAR, job_name VARCHAR,
  input_dataset_namespace VARCHAR, input_dataset_name VARCHAR, input_field VARCHAR,
  output_dataset_namespace VARCHAR, output_dataset_name VARCHAR, output_field VARCHAR,
  transformation_type VARCHAR, transformation_subtype VARCHAR
);
-- A view over a table in the same database: no job sits between them, so the
-- lineage is a direct dataset -> dataset edge (OpenLineage's symlinks facet).
CREATE OR REPLACE TABLE view (view_namespace VARCHAR, view_name VARCHAR, base_namespace VARCHAR, base_name VARCHAR);

INSERT INTO job VALUES
  ('airflow', 'ingest_orders', 'Ingest orders', 'Copies raw orders from Postgres into the lake', 'ingestion'),
  ('airflow', 'ingest_customers', 'Ingest customers', 'Copies raw customers from Postgres into the lake', 'ingestion'),
  ('spark', 'build_orders_clean', 'Build clean orders', 'Cleans and normalizes raw orders', 'transformation'),
  ('spark', 'build_revenue_daily', 'Build daily revenue', 'Aggregates clean orders into daily revenue', NULL),
  ('dbt', 'mart_customer_ltv', 'Customer LTV mart', 'Computes customer lifetime value', 'mart');

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
  ('warehouse', 'marts.customer_ltv', 'first_order_date', 'DATE', NULL),
  ('warehouse', 'marts.revenue_daily_us', 'order_date', 'DATE', NULL),
  ('warehouse', 'marts.revenue_daily_us', 'country', 'VARCHAR', NULL),
  ('warehouse', 'marts.revenue_daily_us', 'revenue_usd', 'DECIMAL(14,2)', NULL),
  ('warehouse', 'marts.revenue_daily_us', 'order_count', 'BIGINT', NULL),
  ('warehouse', 'marts.country_kpis', 'country', 'VARCHAR', NULL),
  ('warehouse', 'marts.country_kpis', 'revenue_usd', 'DECIMAL(16,2)', NULL),
  ('warehouse', 'marts.country_kpis', 'order_count', 'BIGINT', NULL),
  ('warehouse', 'marts.country_kpis', 'customer_count', 'BIGINT', NULL),
  ('warehouse', 'marts.country_kpis', 'avg_lifetime_value_usd', 'DECIMAL(14,2)', NULL),
  ('warehouse', 'marts.us_revenue_share', 'order_date', 'DATE', NULL),
  ('warehouse', 'marts.us_revenue_share', 'us_revenue_usd', 'DECIMAL(14,2)', NULL),
  ('warehouse', 'marts.us_revenue_share', 'total_revenue_usd', 'DECIMAL(16,2)', NULL),
  ('warehouse', 'marts.us_revenue_share', 'us_share', 'DOUBLE', 'Share of the day''s revenue from the US');

INSERT INTO dataset
SELECT DISTINCT dataset_namespace, dataset_name, NULL, NULL, NULL FROM dataset_field;

-- Optional human-friendly titles and descriptions for a few datasets.
UPDATE dataset SET title = 'Orders', description = 'Raw orders from the production Postgres database' WHERE namespace = 'postgres://prod' AND name = 'public.orders';
UPDATE dataset SET title = 'Clean orders', description = 'Cleaned and normalized orders' WHERE namespace = 's3://lake' AND name = 'clean/orders';
UPDATE dataset SET title = 'Daily revenue', description = 'Revenue aggregated per day and country' WHERE namespace = 'warehouse' AND name = 'marts.revenue_daily';

-- Optional presentation-only archetypes. Only some rows carry one; the rest stay NULL.
UPDATE dataset SET archetype = 'source' WHERE namespace = 'postgres://prod';
UPDATE dataset SET archetype = 'staging' WHERE namespace = 's3://lake' AND name LIKE 'clean/%';
UPDATE dataset SET archetype = 'mart' WHERE namespace = 'warehouse';

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

-- A view has one row per table or view it is defined over:
--   marts.revenue_daily_us  over one table (marts.revenue_daily)
--   marts.country_kpis      over two tables (marts.revenue_daily joined with marts.customer_ltv)
--   marts.us_revenue_share  over a view and a table (marts.revenue_daily_us joined with marts.revenue_daily)
INSERT INTO view VALUES
  ('warehouse', 'marts.revenue_daily_us', 'warehouse', 'marts.revenue_daily'),
  ('warehouse', 'marts.country_kpis', 'warehouse', 'marts.revenue_daily'),
  ('warehouse', 'marts.country_kpis', 'warehouse', 'marts.customer_ltv'),
  ('warehouse', 'marts.us_revenue_share', 'warehouse', 'marts.revenue_daily_us'),
  ('warehouse', 'marts.us_revenue_share', 'warehouse', 'marts.revenue_daily');

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

-- View columns derive from their base tables and views; there is no job.
-- marts.revenue_daily_us passes the base table's columns through unchanged.
INSERT INTO column_lineage VALUES
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'order_date', 'warehouse', 'marts.revenue_daily_us', 'order_date', 'DIRECT', 'IDENTITY'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'country', 'warehouse', 'marts.revenue_daily_us', 'country', 'DIRECT', 'IDENTITY'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'revenue_usd', 'warehouse', 'marts.revenue_daily_us', 'revenue_usd', 'DIRECT', 'IDENTITY'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'order_count', 'warehouse', 'marts.revenue_daily_us', 'order_count', 'DIRECT', 'IDENTITY');

-- marts.country_kpis aggregates both base tables per country and joins them on country.
INSERT INTO column_lineage VALUES
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'country', 'warehouse', 'marts.country_kpis', 'country', 'DIRECT', 'IDENTITY'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'revenue_usd', 'warehouse', 'marts.country_kpis', 'revenue_usd', 'DIRECT', 'AGGREGATION'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'order_count', 'warehouse', 'marts.country_kpis', 'order_count', 'DIRECT', 'AGGREGATION'),
  (NULL, NULL, 'warehouse', 'marts.customer_ltv', 'customer_id', 'warehouse', 'marts.country_kpis', 'customer_count', 'DIRECT', 'AGGREGATION'),
  (NULL, NULL, 'warehouse', 'marts.customer_ltv', 'lifetime_value_usd', 'warehouse', 'marts.country_kpis', 'avg_lifetime_value_usd', 'DIRECT', 'AGGREGATION'),
  (NULL, NULL, 'warehouse', 'marts.customer_ltv', 'country', 'warehouse', 'marts.country_kpis', 'country', 'INDIRECT', 'JOIN'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'country', 'warehouse', 'marts.country_kpis', 'revenue_usd', 'INDIRECT', 'GROUP_BY'),
  (NULL, NULL, 'warehouse', 'marts.customer_ltv', 'country', 'warehouse', 'marts.country_kpis', 'customer_count', 'INDIRECT', 'GROUP_BY');

-- marts.us_revenue_share joins the US view with the daily totals of its base table.
INSERT INTO column_lineage VALUES
  (NULL, NULL, 'warehouse', 'marts.revenue_daily_us', 'order_date', 'warehouse', 'marts.us_revenue_share', 'order_date', 'DIRECT', 'IDENTITY'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily_us', 'revenue_usd', 'warehouse', 'marts.us_revenue_share', 'us_revenue_usd', 'DIRECT', 'AGGREGATION'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'revenue_usd', 'warehouse', 'marts.us_revenue_share', 'total_revenue_usd', 'DIRECT', 'AGGREGATION'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily_us', 'revenue_usd', 'warehouse', 'marts.us_revenue_share', 'us_share', 'DIRECT', 'TRANSFORMATION'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'revenue_usd', 'warehouse', 'marts.us_revenue_share', 'us_share', 'DIRECT', 'TRANSFORMATION'),
  (NULL, NULL, 'warehouse', 'marts.revenue_daily', 'order_date', 'warehouse', 'marts.us_revenue_share', 'order_date', 'INDIRECT', 'JOIN');
