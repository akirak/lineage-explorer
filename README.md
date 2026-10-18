# Lineage Explorer

A React Flow explorer for OpenLineage metadata stored in DuckDB. A small Hono
server (TypeScript, run with tsx) reads the database (read-only) and the React
app draws jobs and datasets as a left-to-right lineage graph. [TanStack Router]
keeps the view in the URL so it can be shared or reloaded.

[TanStack Router]: https://tanstack.com/router

## Run it

```bash
npm install
DUCKDB_PATH=/path/to/openlineage.duckdb npm run dev   # http://localhost:5173
```

Production: `npm run build && DUCKDB_PATH=... npm start` (serves on http://localhost:3001).

During `npm run dev`, editing any file under `data/` rebuilds the database and
reloads the browser. The directory is watched by a small Vite plugin
(`plugins/rebuild-db.ts`) and defaults to `data/` in the workspace; change it with
`rebuildDatabase({ dir: '...' })` in `vite.config.ts`. The plugin runs every
`.sql` file it finds under that directory, so those files are the definition of
the database.

Type-check the server and the app with `npm run typecheck`. API response types shared by both live in `shared/types.ts`.

No database yet? `duckdb sample.duckdb < data/build-db.sql` creates a small one
(the [DuckDB CLI](https://duckdb.org/docs/installation/) is in the Nix dev shell).

## Point it at your tables

Edit `server/schema.ts`. It maps each entity table to the columns this app needs.
The explorer models lineage only; it does not read runs or run events.

| Table | Columns used |
|---|---|
| job | namespace, name, optional title, description, archetype |
| dataset | namespace, name, optional title, description, archetype |
| job_input | job namespace, job name, dataset namespace, dataset name |
| job_output | job namespace, job name, dataset namespace, dataset name |
| view | view dataset namespace + name, base dataset namespace + name |
| dataset_field | dataset namespace, dataset name, field name, field type, description |
| column_lineage | job namespace, job name, input dataset namespace + name + field, output dataset namespace + name + field, transformation type, transformation subtype |

Table edges are dataset -> job (`job_input`) and job -> dataset (`job_output`).
A `view` row adds a direct dataset -> dataset edge from a base dataset to a view in the
same database (no job sits between them), following OpenLineage's `symlinks` facet.
A view over several tables or views (a join or union) has one row per base dataset, and a
base dataset may itself be a view.
`column_lineage` has one row per input field of an output field, following the
OpenLineage `columnLineage` facet: the transformation type is `DIRECT` or `INDIRECT`
and the subtype is `IDENTITY`, `TRANSFORMATION`, `AGGREGATION`, `JOIN`, `FILTER`, etc.
The job columns may be NULL when the producing job is unknown.

`title` and `description` on `job` and `dataset` are optional: when the columns are
absent the explorer falls back to the `name`, and when present the title is shown as
the node label (with the description in the tooltip and details panel).

`archetype` on `job` and `dataset` is an optional, presentation-only label such as
`source`, `staging`, `mart`, or `ingestion`. It is shown as a badge on graph nodes,
in the details panel, and in the **/nodes** table (where the list can also be filtered
by it). It never affects the lineage graph itself: nodes, edges, and column lineage
are built without it.

## Using it

- Switch between **Table lineage** (jobs and datasets) and **Column lineage**
  (datasets drawn as tables, edges between columns) in the top bar.
- The current view is stored in the query string, so the URL can be shared or
  reloaded: `mode=column` (table is the default), `namespace=<namespace>`,
  `selected=<node or column id>`, and `isolate=true`. Default values are omitted.
  `?mode=column` opens column mode directly.
- Click a node, or a column in column mode, to highlight its upstream (blue) and downstream (copper) lineage.
  In column mode, solid edges are direct transformations and dashed edges are indirect ones (joins, filters, grouping).
- "Show only this lineage" hides everything else and re-lays out the graph. In column mode it also hides unrelated columns.
- Search by name or namespace (and column name in column mode); filter by namespace; reload to re-query the database.
- **/nodes** lists every job and dataset in a table. Filter by text, namespace, type, or archetype; the filters live in the URL (`q`, `namespace`, `type`, `archetype`). Each row has a **Graph →** link that opens that node in the lineage graph.
- The side panel lists a job's inputs and outputs, a dataset's producers, consumers, and columns,
  and the columns that a column derives from and feeds, with each transformation and its job.
- Views over tables or other views in the same database are drawn as dashed dataset -> dataset
  edges (no job in between); a view's panel lists the tables and views it is defined over, and a
  dataset's panel lists the views defined over it.
