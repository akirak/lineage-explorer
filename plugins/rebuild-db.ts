// ---------------------------------------------------------------------------
// Vite plugin: rebuild the lineage database when a data directory changes.
//
// While `vite dev` is running, editing any file under the watched directory
// rebuilds the database from the `.sql` files it contains, then reloads the
// browser so the explorer shows the new data.
//
//   import { rebuildDatabase } from './plugins/rebuild-db.ts';
//
//   plugins: [tanstackStart(), react(), rebuildDatabase()]              // watch <root>/data
//   plugins: [tanstackStart(), react(), rebuildDatabase({ dir: 'sql' })]
//   plugins: [tanstackStart(), react(), rebuildDatabase({ name: 'lineage', keep: 5 })]
//
// The default rebuild runs the DuckDB CLI over every `.sql` file found under
// the watched directory, then stacks every table it created into a single
// parquet file:
//
//   table_name VARCHAR, data JSON
//
// One parquet file can only hold one table, so stacking them keeps the whole
// database in a single file. The server (`server/lineage.ts`) turns the stacked
// rows back into per-table views.
//
// Each successful rebuild writes a NEW file (`<outDir>/<name>-<timestamp>.parquet`)
// rather than overwriting the previous one. That lets the UI list the available
// builds and switch between them; the selected one is remembered in a cookie.
// Old builds beyond `keep` are pruned after a successful rebuild.
//
// The watch directory and the rebuild itself are configurable; pass `build` to
// replace the SQL-file rebuild with your own generator (e.g. an ingestion
// command that turns files in `dir` into the database).
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export interface RebuildDatabaseOptions {
  /**
   * Directory to watch. Relative paths are resolved against the Vite root.
   * Defaults to `data` (i.e. `/data` in the workspace).
   */
  dir?: string;
  /**
   * Directory the generated parquet files are written to. Relative paths are
   * resolved against the Vite root. Defaults to `builds`.
   */
  outDir?: string;
  /** File name prefix for generated parquet files. Defaults to `lineage`. */
  name?: string;
  /** How many recent parquet builds to keep. Defaults to 10. */
  keep?: number;
  /** Milliseconds to wait after the last change before rebuilding. */
  debounce?: number;
  /** Rebuild once when the dev server starts, in addition to on change. */
  buildOnStart?: boolean;
  /**
   * Replace the default SQL-file rebuild. Receives the watched directory, the
   * target parquet path, and the change that triggered it.
   */
  build?: (context: RebuildContext) => void | Promise<void>;
}

export interface RebuildContext {
  /** Absolute watched directory. */
  dir: string;
  /** Absolute output directory. */
  outDir: string;
  /** File name prefix for the generated parquet file. */
  name: string;
  /** Absolute path the parquet file should be written to. */
  db: string;
  /** Absolute path of the file that triggered the rebuild. */
  file: string;
  /** Watcher event: `add`, `change`, `unlink`, or `start`. */
  event: string;
}

const DEFAULT_DEBOUNCE = 150;
const DEFAULT_KEEP = 10;

export function rebuildDatabase(options: RebuildDatabaseOptions = {}): Plugin {
  let root = process.cwd();

  return {
    name: 'rebuild-db',
    apply: 'serve',

    configResolved(config: ResolvedConfig) {
      root = config.root;
    },

    configureServer(server) {
      const dir = path.resolve(root, options.dir ?? 'data');
      const outDir = path.resolve(root, options.outDir ?? 'builds');
      const name = options.name ?? 'lineage';
      const keep = options.keep ?? DEFAULT_KEEP;
      const logger = server.config.logger;
      const debounce = options.debounce ?? DEFAULT_DEBOUNCE;

      // Watching a directory requires it to exist.
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      cleanStaleTempFiles(outDir);

      let timer: NodeJS.Timeout | undefined;
      let running = false;
      let queued: RebuildContext | undefined;

      const rebuild = async (context: RebuildContext) => {
        if (running) {
          queued = context;
          return;
        }
        running = true;
        try {
          if (options.build) {
            await options.build(context);
          } else {
            await rebuildFromSql(context.dir, context.db);
          }
          await pruneOld(context.outDir, context.name, keep);
          logger.info(`[rebuild-db] wrote ${displayPath(root, context.db)}`);
          server.ws.send({ type: 'full-reload' });
        } catch (error) {
          logger.error(`[rebuild-db] rebuild failed: ${describe(error)}`);
        } finally {
          running = false;
          const next = queued;
          queued = undefined;
          if (next) void rebuild(next);
        }
      };

      const schedule = (file: string, event: string) => {
        const context: RebuildContext = {
          dir,
          outDir,
          name,
          db: path.join(outDir, `${name}-${timestamp()}.parquet`),
          file,
          event,
        };
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void rebuild(context), debounce);
      };

      server.watcher.add(dir);
      server.watcher.on('all', (event, file) => {
        if (event === 'addDir' || event === 'unlinkDir') return;
        const target = path.resolve(file);
        // Ignore generated databases and temporary rebuild output.
        if (isInside(outDir, target)) return;
        if (!isInside(dir, target)) return;
        schedule(target, event);
      });

      if (options.buildOnStart) {
        schedule(dir, 'start');
      }
    },
  };
}

function displayPath(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative.startsWith('..') ? file : relative;
}

/** True when `child` is `parent` or lives beneath it. */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** A filesystem-safe timestamp, e.g. `2026-10-20T01-40-00-000Z`. */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Remove temporary files left behind by a previous crashed rebuild. */
function cleanStaleTempFiles(outDir: string): void {
  for (const entry of readdirSync(outDir)) {
    if (entry.includes('.rebuild-') || entry.includes('.tmp-')) {
      rmSync(path.join(outDir, entry), { force: true });
    }
  }
}

const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`;
const quoteString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Every `.sql` file under `dir`, recursively, in name order. */
async function collectSqlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSqlFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      files.push(full);
    }
  }
  return files.sort();
}

/** Run all `.sql` files in `dir` and stack every table into `db` (parquet). */
async function rebuildFromSql(dir: string, db: string): Promise<void> {
  const files = await collectSqlFiles(dir);
  if (files.length === 0) throw new Error(`no .sql files found under ${dir}`);
  const sql = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  const temporary = `${db}.rebuild-${process.pid}`;
  const temporaryParquet = `${db}.tmp-${process.pid}`;
  try {
    await rm(temporary, { force: true });
    await run('duckdb', [temporary], sql);

    const tables = await listTables(temporary);
    if (tables.length === 0) throw new Error('the SQL did not create any tables');

    const stacked = tables
      .map((table) => `SELECT ${quoteString(table)} AS table_name, to_json(src) AS data FROM ${quoteIdent(table)} AS src`)
      .join('\nUNION ALL\n');

    await rm(temporaryParquet, { force: true });
    await run('duckdb', [temporary], `COPY (\n${stacked}\n) TO ${quoteString(temporaryParquet)} (FORMAT PARQUET);`);
    await rename(temporaryParquet, db);
  } finally {
    await rm(temporary, { force: true });
    await rm(temporaryParquet, { force: true });
  }
}

/** Tables in the `main` schema of a DuckDB file, in name order. */
async function listTables(db: string): Promise<string[]> {
  const stdout = await capture('duckdb', [
    db,
    '-json',
    '-c',
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE' ORDER BY table_name",
  ]);
  const rows = JSON.parse(stdout || '[]') as { table_name: string }[];
  return rows.map((row) => row.table_name);
}

/** Remove all but the `keep` most recent `<name>-*.parquet` files. */
async function pruneOld(outDir: string, name: string, keep: number): Promise<void> {
  const entries = await readdir(outDir).catch(() => [] as string[]);
  const files = entries.filter((file) => file.startsWith(`${name}-`) && file.endsWith('.parquet'));
  if (files.length <= keep) return;
  const dated = await Promise.all(
    files.map(async (file) => ({ file, mtimeMs: (await stat(path.join(outDir, file))).mtimeMs })),
  );
  dated.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of dated.slice(keep)) {
    await rm(path.join(outDir, file), { force: true });
  }
}

/** Run a command, feeding `input` to its stdin, and reject on a non-zero exit. */
function run(command: string, args: string[], input: string): Promise<void> {
  return spawnResult(command, args, input).then(() => undefined);
}

/** Run a command and resolve with its stdout. */
function capture(command: string, args: string[], input?: string): Promise<string> {
  return spawnResult(command, args, input).then((result) => result.stdout);
}

function spawnResult(command: string, args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
