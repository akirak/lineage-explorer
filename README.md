# OpenLineage lineage explorer

A React Flow explorer for OpenLineage metadata stored in DuckDB. A small Express
server reads the database (read-only) and the React app draws jobs and datasets as
a left-to-right lineage graph.

## Run it

```bash
npm install
DUCKDB_PATH=/path/to/openlineage.duckdb npm run dev   # http://localhost:5173
```

Production: `npm run build && DUCKDB_PATH=... npm start` (serves on http://localhost:3001).

No database yet? `node scripts/make-sample-db.js sample.duckdb` creates a small one.

## Point it at your tables

Edit `server/schema.js`. It maps each entity table to the columns this app needs:

| Table | Columns used |
|---|---|
| job | namespace, name |
| dataset | namespace, name |
| run | run id, job namespace, job name, parent run id |
| run_event | run id, event time, event type |
| input_dataset | run id, dataset namespace, dataset name |
| output_dataset | run id, dataset namespace, dataset name |

Edges are derived as dataset -> job (input) and job -> dataset (output) by joining the
input/output tables to `run`. If your input/output tables hold job columns directly
instead of a run id, adjust the `reads` and `writes` queries in `server/queries.js`.

## Using it

- Click a node to highlight its upstream (blue) and downstream (copper) lineage.
- "Show only this lineage" hides everything else and re-lays out the graph.
- Search by name or namespace; filter by namespace; reload to re-query the database.
- A job's dot shows the state of its latest run event; the side panel lists recent runs.
