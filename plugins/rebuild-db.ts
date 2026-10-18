// ---------------------------------------------------------------------------
// Vite plugin: rebuild the DuckDB database when a data directory changes.
//
// While `npm run dev` is running, editing any file under the watched directory
// rebuilds `openlineage.duckdb` from the `.sql` files it contains, then reloads
// the browser so the explorer shows the new data.
//
//   import { rebuildDatabase } from './plugins/rebuild-db.ts';
//
//   plugins: [react(), rebuildDatabase()]                  // watch <root>/data
//   plugins: [react(), rebuildDatabase({ dir: 'sql' })]    // watch <root>/sql
//   plugins: [react(), rebuildDatabase({ db: 'other.duckdb', debounce: 500 })]
//
// The default rebuild runs the DuckDB CLI over every `.sql` file found under
// the watched directory. It writes to a temporary file and then atomically
// replaces the target, so it never fights the read-only connection the API
// server keeps open to the database.
//
// The watch directory and the rebuild itself are configurable; pass `build` to
// replace the SQL-file rebuild with your own generator (e.g. an ingestion
// command that turns files in `dir` into the database).
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export interface RebuildDatabaseOptions {
  /**
   * Directory to watch. Relative paths are resolved against the Vite root.
   * Defaults to `data` (i.e. `/data` in the workspace).
   */
  dir?: string;
  /**
   * DuckDB file to rebuild. Relative paths are resolved against the Vite root.
   * Defaults to `$DUCKDB_PATH`, then `openlineage.duckdb`.
   */
  db?: string;
  /** Milliseconds to wait after the last change before rebuilding. */
  debounce?: number;
  /** Rebuild once when the dev server starts, in addition to on change. */
  buildOnStart?: boolean;
  /**
   * Replace the default SQL-file rebuild. Receives the watched directory, the
   * database path, and the change that triggered it.
   */
  build?: (context: RebuildContext) => void | Promise<void>;
}

export interface RebuildContext {
  dir: string;
  db: string;
  /** Absolute path of the file that triggered the rebuild. */
  file: string;
  /** Watcher event: `add`, `change`, `unlink`, or `start`. */
  event: string;
}

const DEFAULT_DEBOUNCE = 150;

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
      const db = path.resolve(root, options.db ?? process.env.DUCKDB_PATH ?? 'openlineage.duckdb');
      const logger = server.config.logger;
      const debounce = options.debounce ?? DEFAULT_DEBOUNCE;

      // Watching a directory requires it to exist.
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

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
          logger.info(`[rebuild-db] rebuilt ${displayPath(root, context.db)}`);
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

      const schedule = (context: RebuildContext) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void rebuild(context), debounce);
      };

      server.watcher.add(dir);
      server.watcher.on('all', (event, file) => {
        if (event === 'addDir' || event === 'unlinkDir') return;
        const target = path.resolve(file);
        // Ignore the database and its temporary rebuild output.
        if (target === db || target.startsWith(`${db}.`)) return;
        if (!isInside(dir, target)) return;
        schedule({ dir, db, file: target, event });
      });

      if (options.buildOnStart) {
        schedule({ dir, db, file: dir, event: 'start' });
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

/** Run all `.sql` files in `dir` into `db`, replacing it atomically. */
async function rebuildFromSql(dir: string, db: string): Promise<void> {
  const files = await collectSqlFiles(dir);
  if (files.length === 0) return;
  const sql = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  const temporary = `${db}.rebuild-${process.pid}`;
  try {
    await rm(temporary, { force: true });
    await run('duckdb', [temporary], sql);
    await rename(temporary, db);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Run a command, feeding `input` to its stdin, and reject on a non-zero exit. */
function run(command: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    child.stdin?.end(input);
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
