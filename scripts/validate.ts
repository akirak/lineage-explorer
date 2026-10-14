// ---------------------------------------------------------------------------
// Validate the lineage data in a DuckDB database.
//
// Reports referential-integrity problems that make job definitions invalid,
// e.g. a job that reads from a dataset (or column) that does not exist, or a
// job_input/job_output row that points at a job that is not defined.
//
//   DUCKDB_PATH=/path/to/openlineage.duckdb npm run validate
//   tsx scripts/validate.ts /path/to/openlineage.duckdb
//
// Exits with a non-zero status when any issue is found.
// ---------------------------------------------------------------------------
import { DuckDBInstance } from '@duckdb/node-api';
import { schema as s } from '../server/schema.ts';

const DB_PATH = process.env.DUCKDB_PATH || process.argv[2] || './openlineage.duckdb';

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

const instance = await DuckDBInstance.create(DB_PATH, { access_mode: 'READ_ONLY' });
const conn = await instance.connect();

const all = async (sql: string): Promise<Record<string, unknown>[]> => {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson() as unknown as Record<string, unknown>[];
};

// ---------------------------------------------------------------------------
// Table existence
// ---------------------------------------------------------------------------
const tables = new Set(
  Object.values(s).map((m) => m.table),
);

const existingTables = new Set(
  (await all(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main'`)).map(
    (r) => r.name as string,
  ),
);

const missingTables = [...tables].filter((t) => !existingTables.has(t));

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
interface Check {
  name: string;
  /** Tables this check reads from; skipped if any is missing. */
  uses: string[];
  sql: string;
  describe: (row: Record<string, unknown>) => string;
}

const checks: Check[] = [
  {
    name: 'job_input references a defined job',
    uses: [s.input.table, s.job.table],
    sql: `
      SELECT DISTINCT i.${q(s.input.jobNamespace)} AS ns, i.${q(s.input.jobName)} AS name
      FROM ${q(s.input.table)} i
      LEFT JOIN ${q(s.job.table)} j
        ON j.${q(s.job.namespace)} = i.${q(s.input.jobNamespace)}
       AND j.${q(s.job.name)} = i.${q(s.input.jobName)}
      WHERE j.${q(s.job.namespace)} IS NULL`,
    describe: (r) => `job ${r.ns}/${r.name}`,
  },
  {
    name: 'job_input references a defined dataset',
    uses: [s.input.table, s.dataset.table],
    sql: `
      SELECT DISTINCT i.${q(s.input.namespace)} AS ns, i.${q(s.input.name)} AS name
      FROM ${q(s.input.table)} i
      LEFT JOIN ${q(s.dataset.table)} d
        ON d.${q(s.dataset.namespace)} = i.${q(s.input.namespace)}
       AND d.${q(s.dataset.name)} = i.${q(s.input.name)}
      WHERE d.${q(s.dataset.namespace)} IS NULL`,
    describe: (r) => `dataset ${r.ns}/${r.name}`,
  },
  {
    name: 'job_output references a defined job',
    uses: [s.output.table, s.job.table],
    sql: `
      SELECT DISTINCT o.${q(s.output.jobNamespace)} AS ns, o.${q(s.output.jobName)} AS name
      FROM ${q(s.output.table)} o
      LEFT JOIN ${q(s.job.table)} j
        ON j.${q(s.job.namespace)} = o.${q(s.output.jobNamespace)}
       AND j.${q(s.job.name)} = o.${q(s.output.jobName)}
      WHERE j.${q(s.job.namespace)} IS NULL`,
    describe: (r) => `job ${r.ns}/${r.name}`,
  },
  {
    name: 'job_output references a defined dataset',
    uses: [s.output.table, s.dataset.table],
    sql: `
      SELECT DISTINCT o.${q(s.output.namespace)} AS ns, o.${q(s.output.name)} AS name
      FROM ${q(s.output.table)} o
      LEFT JOIN ${q(s.dataset.table)} d
        ON d.${q(s.dataset.namespace)} = o.${q(s.output.namespace)}
       AND d.${q(s.dataset.name)} = o.${q(s.output.name)}
      WHERE d.${q(s.dataset.namespace)} IS NULL`,
    describe: (r) => `dataset ${r.ns}/${r.name}`,
  },
  {
    name: 'view references a defined view dataset',
    uses: [s.view.table, s.dataset.table],
    sql: `
      SELECT DISTINCT v.${q(s.view.viewNamespace)} AS ns, v.${q(s.view.viewName)} AS name
      FROM ${q(s.view.table)} v
      LEFT JOIN ${q(s.dataset.table)} d
        ON d.${q(s.dataset.namespace)} = v.${q(s.view.viewNamespace)}
       AND d.${q(s.dataset.name)} = v.${q(s.view.viewName)}
      WHERE d.${q(s.dataset.namespace)} IS NULL`,
    describe: (r) => `view dataset ${r.ns}/${r.name}`,
  },
  {
    name: 'view references a defined base dataset',
    uses: [s.view.table, s.dataset.table],
    sql: `
      SELECT DISTINCT v.${q(s.view.baseNamespace)} AS ns, v.${q(s.view.baseName)} AS name
      FROM ${q(s.view.table)} v
      LEFT JOIN ${q(s.dataset.table)} d
        ON d.${q(s.dataset.namespace)} = v.${q(s.view.baseNamespace)}
       AND d.${q(s.dataset.name)} = v.${q(s.view.baseName)}
      WHERE d.${q(s.dataset.namespace)} IS NULL`,
    describe: (r) => `base dataset ${r.ns}/${r.name}`,
  },
  {
    name: 'view is not defined over itself, directly or through other views',
    uses: [s.view.table],
    sql: `
      WITH RECURSIVE reach(view_ns, view_name, base_ns, base_name, path) AS (
        SELECT ${q(s.view.viewNamespace)}, ${q(s.view.viewName)}, ${q(s.view.baseNamespace)}, ${q(s.view.baseName)},
               [[${q(s.view.viewNamespace)}, ${q(s.view.viewName)}]]
        FROM ${q(s.view.table)}
        UNION ALL
        SELECT r.view_ns, r.view_name, v.${q(s.view.baseNamespace)}, v.${q(s.view.baseName)},
               list_append(r.path, [r.base_ns, r.base_name])
        FROM reach r
        JOIN ${q(s.view.table)} v
          ON v.${q(s.view.viewNamespace)} = r.base_ns
         AND v.${q(s.view.viewName)} = r.base_name
        WHERE NOT list_contains(r.path, [r.base_ns, r.base_name])
      )
      SELECT DISTINCT view_ns AS ns, view_name AS name
      FROM reach
      WHERE base_ns = view_ns AND base_name = view_name`,
    describe: (r) => `view ${r.ns}/${r.name}`,
  },
  {
    name: 'view column_lineage (no job) reads from one of the view\'s base datasets',
    uses: [s.columnLineage.table, s.view.table],
    sql: `
      SELECT DISTINCT cl.${q(s.columnLineage.outputNamespace)} AS ns, cl.${q(s.columnLineage.outputDataset)} AS name,
             cl.${q(s.columnLineage.inputNamespace)} AS input_ns, cl.${q(s.columnLineage.inputDataset)} AS input_name
      FROM ${q(s.columnLineage.table)} cl
      SEMI JOIN ${q(s.view.table)} v
        ON v.${q(s.view.viewNamespace)} = cl.${q(s.columnLineage.outputNamespace)}
       AND v.${q(s.view.viewName)} = cl.${q(s.columnLineage.outputDataset)}
      ANTI JOIN ${q(s.view.table)} b
        ON b.${q(s.view.viewNamespace)} = cl.${q(s.columnLineage.outputNamespace)}
       AND b.${q(s.view.viewName)} = cl.${q(s.columnLineage.outputDataset)}
       AND b.${q(s.view.baseNamespace)} = cl.${q(s.columnLineage.inputNamespace)}
       AND b.${q(s.view.baseName)} = cl.${q(s.columnLineage.inputDataset)}
      WHERE cl.${q(s.columnLineage.jobNamespace)} IS NULL`,
    describe: (r) => `view ${r.ns}/${r.name} reads ${r.input_ns}/${r.input_name}`,
  },
  {
    name: 'dataset_field references a defined dataset',
    uses: [s.field.table, s.dataset.table],
    sql: `
      SELECT DISTINCT f.${q(s.field.namespace)} AS ns, f.${q(s.field.dataset)} AS name
      FROM ${q(s.field.table)} f
      LEFT JOIN ${q(s.dataset.table)} d
        ON d.${q(s.dataset.namespace)} = f.${q(s.field.namespace)}
       AND d.${q(s.dataset.name)} = f.${q(s.field.dataset)}
      WHERE d.${q(s.dataset.namespace)} IS NULL`,
    describe: (r) => `dataset ${r.ns}/${r.name}`,
  },
  {
    name: 'column_lineage references a defined job (when not NULL)',
    uses: [s.columnLineage.table, s.job.table],
    sql: `
      SELECT DISTINCT cl.${q(s.columnLineage.jobNamespace)} AS ns, cl.${q(s.columnLineage.jobName)} AS name
      FROM ${q(s.columnLineage.table)} cl
      LEFT JOIN ${q(s.job.table)} j
        ON j.${q(s.job.namespace)} = cl.${q(s.columnLineage.jobNamespace)}
       AND j.${q(s.job.name)} = cl.${q(s.columnLineage.jobName)}
      WHERE cl.${q(s.columnLineage.jobNamespace)} IS NOT NULL
        AND j.${q(s.job.namespace)} IS NULL`,
    describe: (r) => `job ${r.ns}/${r.name}`,
  },
  {
    name: 'column_lineage input references a defined dataset',
    uses: [s.columnLineage.table, s.dataset.table],
    sql: `
      SELECT DISTINCT cl.${q(s.columnLineage.inputNamespace)} AS ns, cl.${q(s.columnLineage.inputDataset)} AS name
      FROM ${q(s.columnLineage.table)} cl
      LEFT JOIN ${q(s.dataset.table)} d
        ON d.${q(s.dataset.namespace)} = cl.${q(s.columnLineage.inputNamespace)}
       AND d.${q(s.dataset.name)} = cl.${q(s.columnLineage.inputDataset)}
      WHERE d.${q(s.dataset.namespace)} IS NULL`,
    describe: (r) => `input dataset ${r.ns}/${r.name}`,
  },
  {
    name: 'column_lineage input field exists in dataset_field',
    uses: [s.columnLineage.table, s.field.table],
    sql: `
      SELECT DISTINCT cl.${q(s.columnLineage.inputNamespace)} AS ns,
             cl.${q(s.columnLineage.inputDataset)} AS name,
             cl.${q(s.columnLineage.inputField)} AS field
      FROM ${q(s.columnLineage.table)} cl
      LEFT JOIN ${q(s.field.table)} f
        ON f.${q(s.field.namespace)} = cl.${q(s.columnLineage.inputNamespace)}
       AND f.${q(s.field.dataset)} = cl.${q(s.columnLineage.inputDataset)}
       AND f.${q(s.field.name)} = cl.${q(s.columnLineage.inputField)}
      WHERE f.${q(s.field.name)} IS NULL`,
    describe: (r) => `input column ${r.ns}/${r.name}.${r.field}`,
  },
  {
    name: 'column_lineage output references a defined dataset',
    uses: [s.columnLineage.table, s.dataset.table],
    sql: `
      SELECT DISTINCT cl.${q(s.columnLineage.outputNamespace)} AS ns, cl.${q(s.columnLineage.outputDataset)} AS name
      FROM ${q(s.columnLineage.table)} cl
      LEFT JOIN ${q(s.dataset.table)} d
        ON d.${q(s.dataset.namespace)} = cl.${q(s.columnLineage.outputNamespace)}
       AND d.${q(s.dataset.name)} = cl.${q(s.columnLineage.outputDataset)}
      WHERE d.${q(s.dataset.namespace)} IS NULL`,
    describe: (r) => `output dataset ${r.ns}/${r.name}`,
  },
  {
    name: 'column_lineage output field exists in dataset_field',
    uses: [s.columnLineage.table, s.field.table],
    sql: `
      SELECT DISTINCT cl.${q(s.columnLineage.outputNamespace)} AS ns,
             cl.${q(s.columnLineage.outputDataset)} AS name,
             cl.${q(s.columnLineage.outputField)} AS field
      FROM ${q(s.columnLineage.table)} cl
      LEFT JOIN ${q(s.field.table)} f
        ON f.${q(s.field.namespace)} = cl.${q(s.columnLineage.outputNamespace)}
       AND f.${q(s.field.dataset)} = cl.${q(s.columnLineage.outputDataset)}
       AND f.${q(s.field.name)} = cl.${q(s.columnLineage.outputField)}
      WHERE f.${q(s.field.name)} IS NULL`,
    describe: (r) => `output column ${r.ns}/${r.name}.${r.field}`,
  },
  {
    name: 'job has at least one input or output',
    uses: [s.job.table, s.input.table, s.output.table],
    sql: `
      SELECT j.${q(s.job.namespace)} AS ns, j.${q(s.job.name)} AS name
      FROM ${q(s.job.table)} j
      LEFT JOIN ${q(s.input.table)} i
        ON i.${q(s.input.jobNamespace)} = j.${q(s.job.namespace)}
       AND i.${q(s.input.jobName)} = j.${q(s.job.name)}
      LEFT JOIN ${q(s.output.table)} o
        ON o.${q(s.output.jobNamespace)} = j.${q(s.job.namespace)}
       AND o.${q(s.output.jobName)} = j.${q(s.job.name)}
      WHERE i.${q(s.input.jobNamespace)} IS NULL
        AND o.${q(s.output.jobNamespace)} IS NULL`,
    describe: (r) => `job ${r.ns}/${r.name}`,
  },
  {
    name: 'job is defined only once',
    uses: [s.job.table],
    sql: `
      SELECT ${q(s.job.namespace)} AS ns, ${q(s.job.name)} AS name, COUNT(*) AS n
      FROM ${q(s.job.table)}
      GROUP BY ${q(s.job.namespace)}, ${q(s.job.name)}
      HAVING COUNT(*) > 1`,
    describe: (r) => `job ${r.ns}/${r.name} (${r.n} rows)`,
  },
  {
    name: 'dataset is defined only once',
    uses: [s.dataset.table],
    sql: `
      SELECT ${q(s.dataset.namespace)} AS ns, ${q(s.dataset.name)} AS name, COUNT(*) AS n
      FROM ${q(s.dataset.table)}
      GROUP BY ${q(s.dataset.namespace)}, ${q(s.dataset.name)}
      HAVING COUNT(*) > 1`,
    describe: (r) => `dataset ${r.ns}/${r.name} (${r.n} rows)`,
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
console.log(`Validating ${DB_PATH}\n`);

let total = 0;

if (missingTables.length > 0) {
  console.log('Missing tables:');
  for (const t of missingTables) console.log(`  - ${t}`);
  console.log();
  total += missingTables.length;
}

for (const check of checks) {
  if (check.uses.some((t) => !existingTables.has(t))) {
    console.log(`- ${check.name} (skipped: missing table)`);
    continue;
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await all(check.sql);
  } catch (err) {
    console.log(`! ${check.name} (error: ${(err as Error).message})`);
    total += 1;
    continue;
  }

  if (rows.length === 0) {
    console.log(`✓ ${check.name}`);
  } else {
    console.log(`✗ ${check.name} (${rows.length})`);
    for (const row of rows) console.log(`    - ${check.describe(row)}`);
    total += rows.length;
  }
}

console.log();
if (total === 0) {
  console.log('No issues found.');
  process.exit(0);
} else {
  console.log(`${total} issue${total === 1 ? '' : 's'} found.`);
  process.exit(1);
}
