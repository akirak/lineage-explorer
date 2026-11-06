// ---------------------------------------------------------------------------
// View SQL for the stacked parquet databases.
//
// The `rebuild-db` Vite plugin stacks every source table into a single long
// parquet file (`table_name VARCHAR, data JSON`) because one parquet file can
// only hold one table. These helpers turn such a file back into one view per
// table by extracting the columns out of the `data` JSON, so the rest of the
// explorer can query them exactly as if they were regular tables.
//
// The views are created in the Quack server's DuckDB session in dev (see
// plugins/rebuild-db.ts), or directly in DuckDB-Wasm for Cloudflare snapshots.
// ---------------------------------------------------------------------------
import { schema as s } from './schema.ts';

const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`;
const quoteString = (value: string) => `'${value.replace(/'/g, "''")}'`;
const jsonPath = (key: string) => `$."${key.replace(/"/g, '""')}"`;

/** Tables the explorer reads, mapped to every column `shared/schema.ts` uses. */
export function schemaTables(): Map<string, string[]> {
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
export function viewSql(table: string, columns: string[], file: string): string {
  const selects = columns
    .map((column) => `json_extract_string("data", ${quoteString(jsonPath(column))}) AS ${quoteIdent(column)}`)
    .join(', ');
  return `CREATE OR REPLACE VIEW ${quoteIdent(table)} AS SELECT ${selects} FROM read_parquet(${quoteString(file)}) WHERE "table_name" = ${quoteString(table)}`;
}

/** View statements for every table of the schema over one parquet build. */
export function parquetViews(file: string): string[] {
  return [...schemaTables()].map(([table, columns]) => viewSql(table, columns, file));
}

/**
 * View statements for a plain `.duckdb` file (for example the one produced by
 * `duckdb sample.duckdb < data/build-db.sql`). The file is attached read-only
 * and every schema table gets a view in the main (in-memory) catalog, so
 * unqualified table names keep working over Quack.
 */
export function duckDbViews(file: string): string[] {
  const views = [`ATTACH ${quoteString(file)} AS lineage_src (READ_ONLY);`];
  for (const [table, columns] of schemaTables()) {
    const select = columns.map((column) => quoteIdent(column)).join(', ');
    views.push(
      `CREATE OR REPLACE VIEW ${quoteIdent(table)} AS SELECT ${select} FROM lineage_src.${quoteIdent(table)}`,
    );
  }
  return views;
}
