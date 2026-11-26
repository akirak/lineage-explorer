# Lineage Explorer

An interactive web application for exploring [OpenLineage] metadata stored in [DuckDB]. Built with [TanStack Start], [TanStack Router], [React Flow], and [DuckDB-Wasm], Lineage Explorer visualizes jobs, datasets, views, and column-level transformations as an interactive left-to-right graph.

## Features

- **Table & Column Lineage**: Switch seamlessly between high-level dataset/job flows and fine-grained column-to-column transformations.
- **Interactive Graph Exploration**: Click any node or column to highlight its upstream (blue) and downstream (copper) lineage, isolate connected subgraphs, or pin a node to filter by hop count (`1–4` or `all`) and direction (`upstream` / `downstream`).
- **Views & CRUD Indicators**: Visualize database views as direct dataset-to-dataset edges and color-code job outputs by operation (`Create`, `Update`, `Delete`).
- **Searchable Node Catalog (`/nodes`)**: Browse and filter all jobs and datasets by keyword, namespace, type, or archetype, select several rows with Ctrl-click (⌘-click), and open them all pinned in the graph. Per-namespace query filters narrow each namespace independently and carry over to the graph; named filter sets are persisted in the browser's local storage.
- **Shareable URL State**: View state, selections, pins, and the active filter set ID are stored in the URL query string. Filter definitions stay in local storage and are referenced by ID.
- **Two Execution Modes**:
  - **Local Development / Live Server**: Queries a local or remote DuckDB process over DuckDB's [Quack remote protocol] with live reload whenever SQL files under `data/` change.
  - **Cloudflare Workers Free (Zero-Backend)**: Packages the UI, DuckDB-Wasm, browser extensions, and a Parquet database snapshot into an assets-only Cloudflare Worker that runs entirely in the browser.

---

## Quick Start

### Prerequisites

- **Node.js** `24.11.1+`
- **pnpm**
- **[DuckDB CLI]** on your `PATH`

> **Using Nix?** Run `nix develop` to enter a shell with Node.js, Corepack (`pnpm`), TypeScript, and `duckdb` pre-installed.

### Run Locally

```bash
pnpm install
pnpm dev
```

Open **http://localhost:5173** in your browser.

When `pnpm dev` starts, the `rebuild-db` Vite plugin:
1. Builds a sample database from [`data/build-db.sql`](./data/build-db.sql) into `builds/lineage-<timestamp>.parquet`.
2. Starts a local **Quack server** (`localhost:9494`) that serves the database over the [Quack remote protocol].
3. Watches `data/` for changes—editing any `.sql` file automatically rebuilds the database, updates the server views, and reloads the browser.

---

## Using the Explorer

### Graph View (`/`)

- **Table vs. Column Mode**: Use the graph toolbar to switch between **Table lineage** (jobs and datasets) and **Column lineage** (datasets rendered as tables with edges connecting individual columns).
- **Highlighting Lineage**: Click a job, dataset, or column to highlight its **upstream** dependencies in blue and **downstream** dependents in copper.
  - In **Table mode**, database views are drawn as dashed `dataset -> dataset` edges (with no job in between). Job output edges with CRUD metadata are colored green (`C` – Create), amber (`U` – Update), or red (`D` – Delete).
  - In **Column mode**, solid edges represent `DIRECT` transformations (identity, expressions, aggregations) and dashed edges represent `INDIRECT` transformations (joins, filters, groupings).
- **Isolating a Subgraph**: Enable **Show only this lineage** in the details panel to hide unrelated nodes and re-layout the graph. In column mode unrelated datasets are hidden, but every visible dataset keeps all of its columns on screen.
- **Column Mode Schemas**: Column mode draws each visible dataset as a table with its full column list, so edges land on real schema columns even when the rest of the schema is off the lineage.
- **Pinning & Hop Filtering**: Click **Pin** in the details panel to add the selected node to a pinned card in the viewport while you pan, zoom, or inspect other nodes. Ctrl-click (or ⌘-click) any node to pin or unpin it directly; the card lists every pinned node and filters to the union of their lineages:
  - Click **Bring into view** next to a pinned node to re-select and center it (automatically adding its namespace to the active filter if hidden).
  - Expand the pinned card to restrict the visible graph by **Degree** (`1` to `4` hops, or `All`) and **Show** direction (**All**, **Upstream** only, or **Downstream** only) in both table and column modes. The controls apply to every pinned node.
- **Searching & Filtering**: Search by job, dataset, namespace, or column name; filter the graph to one or more namespaces; or click **Refresh the database** in the header to re-run queries against the database. Per-namespace query filters created in the Nodes view are applied here automatically; the toolbar chip shows how many are active and links back to the editor.
- **Side Details Panel**: Displays descriptions, archetypes, a job's inputs and outputs, a dataset's producers, consumers, views, and schema fields, or a column's upstream/downstream transformations and producing jobs.

### Nodes Directory (`/nodes`)

Switch to **Nodes** in the top navigation bar to browse every job and dataset in a table:
- Filter by search text, namespace, node type (`job` or `dataset`), or `archetype`.
- Use the **Namespaces** multi-select above the table to choose one or more namespaces. Open the collapsible **Namespace filters** accordion to build a separate query for each selected namespace: the selection appears as a vertical tab list (all namespaces are listed when **All namespaces** is selected), and each tab shows a badge when it has filters. While the accordion is open, the active tab limits the table to that namespace. Add any number of field/operator/value rules (for example `Name contains daily` and `Archetype is ETL`) inside a tab. Rules within a namespace are ANDed; nodes from namespaces without filters are unaffected. The namespace selection and filters are inherited by the graph.
- The site-wide header contains the **Filter set** combobox and displays the active set name. Select a saved set there to load its namespaces and filters. In the Nodes view, **Rename** opens a dialog to rename the active set, and **Duplicate** opens a dialog to copy the current namespaces and filters into a new set; leave the duplicate name blank to use **Untitled filter set**. **Clear** in the header clears the active filters and set. Filter set IDs appear only in the `filterSet` URL parameter, so a link with `filterSet=<id>` resolves the stored namespaces and filters when it is opened in the same browser. Changes to a loaded set are saved automatically.
- Click **Graph →** on any row to open and select that node directly in the lineage graph.
- Click a row to select one node, or Ctrl-click (⌘-click) rows to add and remove nodes from the selection. Selected rows are highlighted.
- Click **Select all** to select every node matching the current filters, or **Clear selection** to reset the selection.
- When more than one row is selected, click **View graph with the selected nodes pinned** to open the graph with every selected node pinned (and the pinned-degree controls available).

### URL Query Parameters

All view state is synchronized with the URL (default values are omitted for clean URLs). Namespace selections and per-namespace filters are stored in local filter sets, so the URL only carries the filter set ID:

#### Graph (`/`)

| Parameter | Values | Default | Description |
|---|---|---|---|
| `mode` | `table` \| `column` | `table` | Active lineage view mode |
| `selected` | Node or column ID | `""` | Currently selected job, dataset, or column |
| `pinned` | JSON array of node IDs | `[]` | Jobs or datasets pinned to the viewport |
| `degree` | `1` \| `2` \| `3` \| `4` \| `all` | `all` | Max upstream/downstream hops around each pinned node |
| `direction` | `all` \| `upstream` \| `downstream` | `all` | Restrict lineage around the pinned nodes by direction |
| `isolate` | `true` \| `false` | `false` | Hide nodes outside the selected item's lineage; column mode keeps all columns of each visible dataset |
| `filterSet` | saved filter set ID | `""` | ID of the local filter set that supplies the namespaces and filters |

#### Nodes Table (`/nodes`)

| Parameter | Values | Default | Description |
|---|---|---|---|
| `q` | string | `""` | Free-text search filter |
| `type` | `all` \| `job` \| `dataset` | `all` | Filter by entity type |
| `archetype` | archetype string \| `all` | `all` | Filter by presentation archetype |
| `filterSet` | saved filter set ID | `""` | ID of the local filter set that supplies the namespaces and filters |

---

## Using Your Own Data

### 1. Supplying the Database

You can feed data into Lineage Explorer in two ways:

1. **SQL definitions in `data/` (recommended)**: Replace or add `.sql` files under `data/`. Both `pnpm dev` and `pnpm build:cloudflare` execute all `.sql` files in `data/` using the DuckDB CLI to construct the lineage tables.
2. **An existing `.duckdb` file**: Point `DUCKDB_PATH` at your database file when starting the dev server:
   ```bash
   DUCKDB_PATH=/path/to/lineage.duckdb pnpm dev
   ```
   *(To generate a standalone `openlineage.duckdb` file from the sample SQL, run `pnpm sample`.)*

### 2. Mapping Your Schema (`shared/schema.ts`)

Lineage Explorer models static lineage metadata (it does not read runtime job runs or run events). If your DuckDB tables or columns use different names, edit **[`shared/schema.ts`](./shared/schema.ts)**—the single configuration file that maps your table and column names to the explorer.

| Entity (`shared/schema.ts`) | Default Table | Required Columns | Optional Columns | Description |
|---|---|---|---|---|
| `job` | `job` | `namespace`, `name` | `title`, `description`, `archetype` | One row per job |
| `dataset` | `dataset` | `namespace`, `name` | `title`, `description`, `archetype` | One row per table, file, or view |
| `input` | `job_input` | `job_namespace`, `job_name`, `dataset_namespace`, `dataset_name` | — | Datasets read by a job (`dataset -> job`) |
| `output` | `job_output` | `job_namespace`, `job_name`, `dataset_namespace`, `dataset_name` | `crud` | Datasets written by a job (`job -> dataset`) |
| `view` | `view` | `view_namespace`, `view_name`, `base_namespace`, `base_name` | — | Direct `dataset -> dataset` edges for views over base tables/views |
| `field` | `dataset_field` | `dataset_namespace`, `dataset_name`, `field_name`, `field_type` | `description`, `required` | Schema columns of a dataset |
| `columnLineage` | `column_lineage` | `input_dataset_namespace`, `input_dataset_name`, `input_field`, `output_dataset_namespace`, `output_dataset_name`, `output_field`, `transformation_type`, `transformation_subtype` | `job_namespace`, `job_name`, `description` | Column-level lineage edges |

#### Schema Conventions & Optional Metadata

- **`title` & `description`** (`job`, `dataset`): When `title` is present and non-null, it is displayed as the node's primary label (falling back to `name`). `description` is shown in tooltips and the details panel.
- **`archetype`** (`job`, `dataset`): A presentation-only badge such as `source`, `staging`, `mart`, or `ingestion`. Shown on graph nodes, in the details panel, and as a filter on `/nodes`. It does not affect graph structure.
- **`crud`** (`job_output`): Indicates how a job modifies an output dataset: `C` (Create, green), `U` (Update, amber), or `D` (Delete, red). When absent or `NULL`, edges use the default color.
- **`required`** (`dataset_field`): A presentation-only marker for non-nullable or mandatory columns. When the column exists and is truthy (`true`, `1`, `yes`), the column name is followed by a red asterisk (`*`) in the graph and details panel. When the column is absent or `NULL`, no marker is shown.
- **`view`**: Models database views following OpenLineage's `symlinks` facet. Each row adds a direct `base dataset -> view dataset` edge with no job in between. A view joining or unioning multiple tables/views has one row per base dataset.
- **`column_lineage`**: Follows the OpenLineage `columnLineage` facet, with one row per input field feeding an output field:
  - `transformation_type`: `DIRECT` or `INDIRECT`
  - `transformation_subtype`: `IDENTITY`, `TRANSFORMATION`, `AGGREGATION`, `JOIN`, `FILTER`, etc.
  - `job_namespace` and `job_name` may be `NULL` (for example, when lineage is defined by a database view or the producing job is unknown).

### 3. Validating Data Integrity

Use the built-in validation script ([`scripts/validate.ts`](./scripts/validate.ts)) to check a `.duckdb` database for referential integrity issues—such as missing tables, orphaned `job_input`/`job_output` references, undefined datasets or columns in `column_lineage`, circular view definitions, or duplicate jobs/datasets:

```bash
pnpm sample     # build ./openlineage.duckdb from data/build-db.sql
pnpm validate   # validate ./openlineage.duckdb (or pass a path / set DUCKDB_PATH)
```

---

## Deployment

### TODO: Option A: Cloudflare Workers Free (Self-Contained Snapshot)

[`alchemy.run.ts`](./alchemy.run.ts) uses [Alchemy] to publish an **assets-only Cloudflare Worker** containing the prerendered SPA shell, JS/CSS bundles, DuckDB-Wasm, signed DuckDB browser extensions (`parquet` and `json`), and a Parquet snapshot built from `data/`.

Because all queries run client-side in DuckDB-Wasm against the static snapshot:
- **No server runtime or paid services are used**—no Workers Paid plan, R2, D1, KV, Durable Objects, Containers, or external Quack server.
- Cloudflare serves static asset requests for free, including SPA deep links like `/nodes`.

#### First Deployment

```bash
pnpm install
pnpm exec alchemy profile edit --add Cloudflare
pnpm run deploy
```

Authenticate via Alchemy's OAuth or API-token prompt. The command deploys stage `prod` and outputs your `https://<site>.<account>.workers.dev` URL.

For non-interactive / CI environments, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (in your environment or a gitignored `.env` file). The API token requires:
- **Account → Workers Scripts → Edit**
- **Account Settings → Read**

> **Security Warning:** Never place Cloudflare credentials in `VITE_*` variables or `QUACK_TOKEN`, as those are embedded into the public browser bundle.

#### Deployment Commands

```bash
pnpm exec alchemy plan --stage prod   # Preview infrastructure changes
pnpm build:cloudflare                 # Build snapshot & verify asset limits locally
pnpm start                            # Preview production build at http://localhost:3001
pnpm test:deployment                  # Run snapshot and asset-limit test suite
pnpm run destroy                      # Tear down the prod deployment
```

#### Operational Notes & Limits

- **Public Data Warning**: The deployed site has no built-in authentication, and the Parquet snapshot is publicly downloadable. Only deploy metadata you intend to make public, or put the site behind access control (such as Cloudflare Access) before deploying sensitive lineage.
- **Updating Data**: Every deploy rebuilds the snapshot directly from the `.sql` files in `data/` (ignoring old files in `builds/` or `DUCKDB_PATH`). Edit `data/*.sql` and run `pnpm run deploy` to publish updates, then reload the browser page to fetch the new content-hashed snapshot.
- **Alchemy State (`.alchemy/state/`)**: Alchemy tracks deployment state locally in `.alchemy/state/`. Keep this directory backed up and use the same state for subsequent deploys or destroys. Do not delete it or run concurrent deployments from different machines without configuring shared state.
- **Cloudflare Free Asset Limits**: Workers Free allows up to **20,000 static assets** and **25 MiB per asset**. `scripts/check-cloudflare-assets.ts` verifies these limits before upload. Because raw DuckDB WASM binaries exceed 25 MiB, `plugins/compressed-wasm.ts` compresses them to `.gz` (~8–9 MiB) at build time and inflates them in the browser via `DecompressionStream`.
- **Upgrading `@duckdb/duckdb-wasm`**: When bumping `@duckdb/duckdb-wasm`, update `engineVersion` in `scripts/build-snapshot.ts` (currently `v1.5.4`, which corresponds to the internal DuckDB engine version rather than the npm package version) and verify that extension downloads succeed.

---

### Option B: External Quack Server (Live Remote Queries)

If you prefer querying a live DuckDB server instead of bundling a static snapshot in the browser:

1. **Start a DuckDB Quack server** wherever your database resides (see the DuckDB docs on [securing a server with a reverse proxy]):
   ```bash
   duckdb :memory: -c "LOAD quack; CALL quack_serve('quack:my-server:9494', token => '<token>');"
   ```
   *(To serve a `.duckdb` file or stacked Parquet file, attach it or create the views from [`shared/views.ts`](./shared/views.ts) in that session before calling `quack_serve`.)*

2. **Build the client bundle** with your server's URI and token:
   ```bash
   QUACK_URI='quack:my-server:9494' QUACK_TOKEN='<token>' pnpm build
   pnpm start   # Preview at http://localhost:3001
   ```

---

## Architecture & Configuration

### How Data Flows

1. **Database Build (`plugins/rebuild-db.ts`)**: Runs the DuckDB CLI over all `.sql` files in `data/`. Because a single Parquet file holds a single table, the plugin stacks all lineage tables into one file (`table_name VARCHAR, data JSON`) written to `builds/lineage-<timestamp>.parquet` and prunes old builds beyond `keep` (default `10`).
2. **Per-Table Views (`shared/views.ts`)**: Generates `CREATE OR REPLACE VIEW` statements that unpack the `data` JSON back into virtual tables matching [`shared/schema.ts`](./shared/schema.ts).
3. **Query Execution (`src/quack.ts` & `shared/queries.ts`)**:
   - **In Dev / Quack Mode**: The Vite plugin keeps a long-lived `duckdb` process running with `quack_serve` on `localhost:9494` and passes the URI and a generated auth token to the browser via `virtual:quack-config`. The browser loads DuckDB-Wasm, installs the `quack` extension, and runs all SQL queries remotely via `quack_query(...)`.
   - **In Cloudflare Snapshot Mode**: The browser registers the bundled Parquet file directly in DuckDB-Wasm, creates the unpacking views locally, and runs the exact same SQL queries in-memory without the `quack` extension.

### Configuring the Vite Plugin (`vite.config.ts`)

You can customize `rebuildDatabase({...})` in [`vite.config.ts`](./vite.config.ts):

```ts
rebuildDatabase({
  dir: 'data',          // Directory watched for .sql changes
  outDir: 'builds',     // Output directory for stacked Parquet builds
  name: 'lineage',      // Filename prefix (<name>-<timestamp>.parquet)
  keep: 10,             // Number of recent builds to retain
  buildOnStart: true,   // Rebuild when the dev server starts
  quack: {
    port: 9494,
    token: 'my-fixed-token', // Optional: pin token across dev-server restarts
  },
})
```

Pass `quack: false` if you want to run your own Quack server process externally during development.

### Available Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start the Vite dev server, build the database from `data/`, and run the local Quack server |
| `pnpm build` | Build the app for use with an external Quack server (`QUACK_URI` / `QUACK_TOKEN`) |
| `pnpm build:cloudflare` | Build the Parquet snapshot, download DuckDB extensions, build the SPA, and check Cloudflare asset limits |
| `pnpm start` | Preview the built app locally on `http://localhost:3001` |
| `pnpm sample` | Create a standalone `openlineage.duckdb` file from `data/build-db.sql` |
| `pnpm validate` | Check referential integrity of `openlineage.duckdb` (or `DUCKDB_PATH`) |
| `pnpm typecheck` | Run TypeScript type checking (`tsc`) |
| `pnpm test:deployment` | Run tests for the Cloudflare snapshot build and WASM compression |
| `pnpm run deploy` | Deploy the static site to Cloudflare Workers (`prod` stage) via Alchemy |
| `pnpm run destroy` | Remove the Cloudflare Workers deployment (`prod` stage) |

[OpenLineage]: https://openlineage.io/
[DuckDB]: https://duckdb.org/
[DuckDB CLI]: https://duckdb.org/docs/installation/
[DuckDB-Wasm]: https://duckdb.org/docs/2.0/clients/wasm/overview
[Quack remote protocol]: https://duckdb.org/docs/2.0/quack/overview
[securing a server with a reverse proxy]: https://duckdb.org/docs/2.0/quack/setup/reverse_proxy.html
[TanStack Start]: https://tanstack.com/start
[TanStack Router]: https://tanstack.com/router
[React Flow]: https://reactflow.dev/
[Alchemy]: https://alchemy.run/
