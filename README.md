# Lineage Explorer

A React Flow explorer for OpenLineage metadata stored in DuckDB. A
[TanStack Start] app (TypeScript, built with Vite) loads [DuckDB-Wasm] in the
browser and queries the database over the [Quack remote protocol] while a
DuckDB process serves it during development. The Cloudflare deployment instead
queries a published database snapshot entirely in the browser. The React app
draws jobs and datasets as a left-to-right lineage graph. [TanStack Router] keeps
the view in the URL so it can be shared or reloaded.

[TanStack Start]: https://tanstack.com/start
[TanStack Router]: https://tanstack.com/router
[DuckDB-Wasm]: https://duckdb.org/docs/2.0/clients/wasm/overview
[Quack remote protocol]: https://duckdb.org/docs/2.0/quack/overview

## Run it

```bash
pnpm install
pnpm dev   # http://localhost:5173
```

`pnpm dev` starts TanStack Start, which serves the UI. The `rebuild-db` Vite
plugin builds the database when the dev server starts and whenever the SQL
under `data/` changes, and runs the **Quack server** — a DuckDB process on
`localhost:9494` that serves the rebuilt database over DuckDB's [Quack remote
protocol]. The browser connects to it with DuckDB-Wasm and runs every query
remotely on the server; nothing about the database is read client-side.

The plugin generates a fresh Quack token on every dev-server start and hands
the URI and token to the browser through a virtual module
(`virtual:quack-config`), so nothing has to be configured by hand. To pin the
token instead (e.g. to keep other clients working across dev-server restarts),
pass it as a plugin option:

```ts
rebuildDatabase({ quack: { token: 'my-fixed-token' } })
```

## Deploy the entire app to Cloudflare Free

[`alchemy.run.ts`](./alchemy.run.ts) uses [Alchemy](https://alchemy.run) to
publish an **assets-only Cloudflare Worker**: the SPA shell, JS/CSS, DuckDB-Wasm,
its JSON/Parquet extensions, and a database snapshot. There is no server code to
invoke, no external Quack server, and no R2, D1, KV, Durable Objects, or Containers.
Cloudflare serves static asset requests for free, including SPA deep links such
as `/nodes`. You do not need a custom domain or a Workers Paid subscription.

A long-running DuckDB/Quack process cannot run on Workers Free. To fit the entire
app on that tier, `pnpm build:cloudflare` rebuilds the SQL under `data/` into a
parquet snapshot and the browser queries it locally. Local development keeps
using Quack unchanged.

### First deployment

Requirements: Node.js **24.11.1+**, pnpm, the [DuckDB CLI] on `PATH` (included in
`nix develop`), and a Cloudflare account. The build downloads the signed DuckDB
browser extensions from `extensions.duckdb.org`; visitors load them from your own
site. Alchemy and its Cloudflare provider are pinned to the same v2 beta version.

```bash
pnpm install
pnpm exec alchemy profile edit --add Cloudflare
pnpm run deploy
```

Authenticate through Alchemy's OAuth/API-token prompt. The deploy command targets
stage `prod` and prints your `https://<site>.<account>.workers.dev` URL. For
noninteractive credentials, export `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` instead; the token needs **Account → Workers Scripts → Edit**
and **Account Settings → Read** for the target account. Alchemy also reads `.env`
(which is gitignored). Do not put Cloudflare credentials in `VITE_*` variables or
`QUACK_TOKEN` — they must never be shipped to the browser.

```bash
pnpm exec alchemy plan --stage prod   # preview infrastructure changes
pnpm build:cloudflare                 # build/check without deploying
pnpm start                            # preview locally at http://localhost:3001
pnpm test:deployment                  # snapshot and asset-limit tests
pnpm run destroy                     # remove the prod deployment
```

**State:** Alchemy tracks resources locally in `.alchemy/state/`. Keep this
private directory backed up and use the same state for subsequent deploys and
destroys. Do not delete it or run deployments concurrently from different
machines; CI needs persisted/shared state before it can safely manage this stack.
No remote state service is provisioned by this configuration.

### Data, refreshes, and limits

- **All deployed lineage data is public and downloadable.** This configuration
  adds no authentication. Deploy only data you are happy to publish, or add access
  control before deploying sensitive metadata.
- Each deploy builds from **all SQL under `data/`**, not old files in `builds/`
  or the development `DUCKDB_PATH`. Edit those SQL sources and run `pnpm run deploy`
  to publish new data. The in-app refresh re-queries the current snapshot; reload
  the page after a new deployment to load its new content-hashed database URL.
- Only `dist/client/` is uploaded. TanStack Start prerenders `index.html` as the
  SPA shell; the generated `dist/server/` is build-time scaffolding, not deployed
  SSR. There are no server/API endpoints in this mode.
- Workers Free permits **20,000 static assets** and **25 MiB per asset**. The
  build fails before upload if these limits are exceeded, including the database.
  DuckDB's raw WASM modules are larger than 25 MiB, so
  `plugins/compressed-wasm.ts` publishes gzip files (~8–9 MiB each) that the
  browser inflates before instantiation. No paid object storage is needed.
- The runtime and required extensions are served from the same origin. Google
  Fonts remains an optional external stylesheet; the app works without it.
  Modern browsers with WebAssembly and `DecompressionStream` are required.
- When upgrading `@duckdb/duckdb-wasm`, update the matching **engine version**
  in `scripts/build-snapshot.ts` too (currently `v1.5.4`; this differs from the
  npm package version), and verify both WASM architectures' extension downloads.

### Alternative: production with an external Quack server

If you prefer live remote queries instead of a public snapshot, the original
production build is still available (this is **not** a self-contained Cloudflare
Free deployment):

```bash
QUACK_URI='quack:my-server:9494' QUACK_TOKEN='<token>' pnpm build
pnpm start   # http://localhost:3001
```

There are no `/api/*` routes anymore: this production bundle needs a Quack
server to talk to, configured with `QUACK_URI` and `QUACK_TOKEN` at build
time. Run one anywhere DuckDB is available, e.g.

```bash
duckdb :memory: -c "LOAD quack; CALL quack_serve('quack:my-server:9494', token => '<token>');"
```

(see the Quack docs for [securing a server with a reverse proxy]). A plain
`.duckdb` file can be served by attaching it first; see `shared/views.ts`.

Type-check the app with `pnpm typecheck`. Types shared by the plugin and the
browser client live in `shared/`.

## How the data flows

The Vite plugin (`plugins/rebuild-db.ts`) runs the [DuckDB CLI] over every
`.sql` file it finds under `data/`, so those files are the definition of the
database. Because a parquet file holds a single table, the plugin stacks every
table the SQL created into one parquet file:

```
table_name VARCHAR, data JSON
```

Each successful rebuild writes a **new** file, `builds/lineage-<timestamp>.parquet`,
instead of overwriting the previous one, so older builds stay available. Old
builds beyond `keep` (default 10) are pruned. The plugin reloads the browser
after a build.

The Quack server is a long-lived `duckdb` process the plugin keeps running
with its stdin held open. On start it installs and loads the `quack` extension
and calls `quack_serve` on `localhost:9494`; after every rebuild the plugin
re-issues `CREATE OR REPLACE VIEW` statements for the new parquet file, so the
next query from the browser sees the updated data. The views
(`shared/views.ts`) recreate one table per stacked table by extracting the
columns out of the `data` JSON, so the rest of the explorer queries them
exactly as if they were regular tables.

In the browser, `src/quack.ts` loads DuckDB-Wasm, installs the `quack`
extension (from the `core_nightly` repository, with a fallback to the default
one), creates a `quack` secret from the virtual module, and runs the graph
queries (`shared/queries.ts`) through the stateless `quack_query` table
function. Each query in Quack mode executes on the server, so the parquet files
and views never have to exist client-side. In Cloudflare snapshot mode, the client instead
registers the downloaded parquet file in DuckDB-Wasm, creates the same views,
and runs the same SQL locally without loading Quack. The graph itself (nodes,
edges, column lineage) is assembled in the browser from those query results.

Set `rebuildDatabase({ dir, outDir, name, keep, quack })` in `vite.config.ts`
to change what is watched, where builds are written, and how the Quack server
runs (`quack: { port, token, hostname, command }`, or `quack: false` to run
your own). A plain `.duckdb` file is still supported through `DUCKDB_PATH`
(for example the output of `duckdb sample.duckdb < data/build-db.sql`); the
plugin serves it instead of the parquet builds. `pnpm sample` creates it for
you.

## Databases

In development / external-Quack mode, the Quack server always serves the
**newest** parquet build. **Refresh the database** in the top bar re-runs the
queries, which picks up whatever the
server currently serves; editing the SQL under `data/` rebuilds and re-points
the server automatically, then reloads the browser.

> The previous version listed the available builds and switched between them
> through `/api/*` routes and a cookie. Those routes are gone with the server
> API; if you need to look at an older build, point `DUCKDB_PATH` at a file or
> re-run the SQL that produced it.

## Point it at your tables

Edit `shared/schema.ts`. It maps each entity table to the columns this app needs.
The explorer models lineage only; it does not read runs or run events.

| Table | Columns used |
|---|---|
| job | namespace, name, optional title, description, archetype |
| dataset | namespace, name, optional title, description, archetype |
| job_input | job namespace, job name, dataset namespace, dataset name |
| job_output | job namespace, job name, dataset namespace, dataset name, optional crud |
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

`crud` on `job_output` is an optional marker for what the job does to the output
dataset: `C` creates it, `U` updates it, and `D` deletes it. In table lineage the
job -> dataset arrows are colored green, amber, or red by this marker, and the
legend lists the markers present in the graph. Without the column the output
arrows keep the default color. Input and view edges are never colored by CRUD.

## Using it

- Switch between **Table lineage** (jobs and datasets) and **Column lineage**
  (datasets drawn as tables, edges between columns) in the graph toolbar. The **Graph** and
  **Nodes** links live in the global navigation above it.
- The current view is stored in the query string, so the URL can be shared or
  reloaded: `mode=column` (table is the default), `namespaces=["<namespace>"]`,
  `degree=<1-4>` (or `all`), `direction=<upstream|downstream>`, `selected=<node or column id>`,
  `pinned=<node id>`, and `isolate=true`. Default values are omitted. `?mode=column` opens column mode directly.
- Click a node, or a column in column mode, to highlight its upstream (blue) and downstream (copper) lineage.
  In column mode, solid edges are direct transformations and dashed edges are indirect ones (joins, filters, grouping).
- "Show only this lineage" hides everything else and re-lays out the graph. In column mode it also hides unrelated columns.
- Pin a selected job or dataset with **Pin** in the details panel. A card for the pinned
  node stays in the graph viewport while you pan, zoom, or select something else; **Bring
  into view** selects and centers the node again, adding its namespace to the filter if it
  was hidden. The card starts collapsed, showing just the node title and icon actions; its
  expanded form has a **Degree** select that limits the visible graph to one to four
  upstream/downstream hops from the pinned node in both table and column lineage; tick
  **All** (the default) to remove the limit. A **Show** radio group below the degree control
  filters the visible nodes to **All**, **Downstream** only, or **Upstream** only; the direction
  filter also applies when the degree limit is off. The pinned node, degree, and direction are
  kept in the URL as `pinned=<node id>`, `degree=<1-4|all>`, and `direction=<all|upstream|downstream>`.
- Search by name or namespace (and column name in column mode); filter by one or more
  namespaces; reload to re-query the database.
- **/nodes** lists every job and dataset in a table. Filter by text, namespace, type, or archetype; the filters live in the URL (`q`, `namespace`, `type`, `archetype`). Each row has a **Graph ->** link that opens that node in the lineage graph.
- The side panel lists a job's inputs and outputs, a dataset's producers, consumers, and columns,
  and the columns that a column derives from and feeds, with each transformation and its job.
- Views over tables or other views in the same database are drawn as dashed dataset -> dataset
  edges (no job in between); a view's panel lists the tables and views it is defined over, and a
  dataset's panel lists the views defined over it.

No database yet? `pnpm sample` creates `openlineage.duckdb` from
`data/build-db.sql` (the [DuckDB CLI] is in the Nix dev shell), or just run
`pnpm dev` to build a parquet database from the same SQL.

[securing a server with a reverse proxy]: https://duckdb.org/docs/2.0/quack/setup/reverse_proxy.html
[DuckDB CLI]: https://duckdb.org/docs/installation/
