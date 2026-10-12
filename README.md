# OpenLineage lineage explorer

A React Flow explorer for OpenLineage metadata stored in DuckDB. A small Hono
server (TypeScript, run with tsx) reads the database (read-only) and the React
app draws jobs and datasets as a left-to-right lineage graph.

## Run it

```bash
npm install
DUCKDB_PATH=/path/to/openlineage.duckdb npm run dev   # http://localhost:5173
```

Production: `npm run build && DUCKDB_PATH=... npm start` (serves on http://localhost:3001).

Type-check the server and the app with `npm run typecheck`. API response types shared by both live in `shared/types.ts`.

No database yet? `duckdb sample.duckdb < scripts/sample-db.sql` creates a small one
(the [DuckDB CLI](https://duckdb.org/docs/installation/) is in the Nix dev shell).

## Point it at your tables

Edit `server/schema.ts`. It maps each entity table to the columns this app needs.
The explorer models lineage only; it does not read runs or run events.

| Table | Columns used |
|---|---|
| job | namespace, name |
| dataset | namespace, name |
| job_input | job namespace, job name, dataset namespace, dataset name |
| job_output | job namespace, job name, dataset namespace, dataset name |
| dataset_field | dataset namespace, dataset name, field name, field type, description |
| column_lineage | job namespace, job name, input dataset namespace + name + field, output dataset namespace + name + field, transformation type, transformation subtype |

Table edges are dataset -> job (`job_input`) and job -> dataset (`job_output`).
`column_lineage` has one row per input field of an output field, following the
OpenLineage `columnLineage` facet: the transformation type is `DIRECT` or `INDIRECT`
and the subtype is `IDENTITY`, `TRANSFORMATION`, `AGGREGATION`, `JOIN`, `FILTER`, etc.
The job columns may be NULL when the producing job is unknown.

## Using it

- Switch between **Table lineage** (jobs and datasets) and **Column lineage**
  (datasets drawn as tables, edges between columns) in the top bar. `?mode=column`
  opens column mode directly.
- Click a node, or a column in column mode, to highlight its upstream (blue) and downstream (copper) lineage.
  In column mode, solid edges are direct transformations and dashed edges are indirect ones (joins, filters, grouping).
- "Show only this lineage" hides everything else and re-lays out the graph. In column mode it also hides unrelated columns.
- Search by name or namespace (and column name in column mode); filter by namespace; reload to re-query the database.
- The side panel lists a job's inputs and outputs, a dataset's producers, consumers, and columns,
  and the columns that a column derives from and feeds, with each transformation and its job.
