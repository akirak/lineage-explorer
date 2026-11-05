// ---------------------------------------------------------------------------
// Vite plugin: rebuild the lineage database when a data directory changes,
// and serve it over the Quack remote protocol in dev mode.
//
// While `vite dev` is running, editing any file under the watched directory
// rebuilds the database from the `.sql` files it contains, re-points the
// Quack server at the new build, then reloads the browser so the explorer
// shows the new data.
//
//   import { rebuildDatabase } from './plugins/rebuild-db.ts';
//
//   plugins: [tanstackStart(), react(), ...rebuildDatabase()]              // watch <root>/data
//   plugins: [tanstackStart(), react(), ...rebuildDatabase({ dir: 'sql' })]
//   plugins: [tanstackStart(), react(), ...rebuildDatabase({ name: 'lineage', keep: 5 })]
//
// The default rebuild runs the DuckDB CLI over every `.sql` file found under
// the watched directory, then stacks every table it created into a single
// parquet file:
//
//   table_name VARCHAR, data JSON
//
// One parquet file can only hold one table, so stacking them keeps the whole
// database in a single file. The Quack server session turns the stacked rows
// back into per-table views (shared/views.ts).
//
// Each successful rebuild writes a NEW file (`<outDir>/<name>-<timestamp>.parquet`)
// rather than overwriting the previous one. Old builds beyond `keep` are
// pruned after a successful rebuild.
//
// The Quack server is a long-lived `duckdb` process that loads the `quack`
// extension and calls `quack_serve`. It exposes everything its session can
// see, so after every rebuild the plugin re-issues `CREATE OR REPLACE VIEW`
// statements for the new parquet file and the next query from the browser
// sees the updated data. The browser connects with DuckDB-Wasm; the URI and
// token it needs are injected through the `virtual:quack-config` module
// (resolved by this plugin in dev, and from `QUACK_URI` / `QUACK_TOKEN` in
// production builds).
//
// The watch directory and the rebuild itself are configurable; pass `build` to
// replace the SQL-file rebuild with your own generator (e.g. an ingestion
// command that turns files in `dir` into the database).
// ---------------------------------------------------------------------------
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { duckDbViews, parquetViews } from '../shared/views.ts';

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
   * Serve the database over the Quack remote protocol while the dev server
   * runs. Pass `false` to skip it (e.g. when you run your own Quack server).
   * Options: port, token, hostname, command.
   */
  quack?: false | QuackOptions;
  /**
   * Replace the default SQL-file rebuild. Receives the watched directory, the
   * target parquet path, and the change that triggered it.
   */
  build?: (context: RebuildContext) => void | Promise<void>;
}

export interface QuackOptions {
  /** Port the Quack server listens on. Defaults to 9494, Quack's default. */
  port?: number;
  /**
   * Authentication token clients must present. Defaults to a random token
   * generated once per dev-server start. Pass a fixed one to keep browsers
   * working across dev-server restarts.
   */
  token?: string;
  /**
   * Hostname to bind. Quack refuses non-local hostnames unless
   * `allow_other_hostname` is set, so this stays localhost-only; the option
   * exists for setups where `localhost` resolves unexpectedly.
   */
  hostname?: string;
  /** DuckDB CLI to run. Defaults to `duckdb` from the PATH. */
  command?: string;
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
const DEFAULT_QUACK_PORT = 9494;

/** URI + token the browser needs to reach the Quack server. */
export interface QuackConfig {
  uri: string;
  token: string;
}

const VIRTUAL_MODULE_ID = 'virtual:quack-config';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_MODULE_ID}`;

export function rebuildDatabase(options: RebuildDatabaseOptions = {}): Plugin[] {
  const quackOptions: QuackOptions | false = options.quack ?? {};
  const port = quackOptions ? (quackOptions.port ?? DEFAULT_QUACK_PORT) : DEFAULT_QUACK_PORT;
  const hostname = quackOptions ? (quackOptions.hostname ?? 'localhost') : 'localhost';
  // A fresh token per dev-server start; browsers get it through the virtual
  // module, so nothing has to be configured by hand.
  const token = quackOptions
    ? (quackOptions.token ??
      (typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID().replace(/-/g, '')
        : `lineage-${Date.now()}`))
    : '';
  const live: QuackConfig = { uri: `quack:${hostname}:${port}`, token };

  // ---------------------------------------------------------------------
  // Dev-only plugin: watch, rebuild, and run the Quack server.
  // ---------------------------------------------------------------------
  const servePlugin: Plugin = {
    name: 'rebuild-db',
    apply: 'serve',

    configResolved(config: ResolvedConfig) {
      root = config.root;
    },

    async configureServer(server: ViteDevServer) {
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

      // Optional legacy single-file database, served instead of the builds.
      const envDb = process.env.DUCKDB_PATH ? path.resolve(root, process.env.DUCKDB_PATH) : undefined;

      const quack =
        quackOptions === false
          ? null
          : new QuackServer({
              command: quackOptions.command ?? 'duckdb',
              uri: live.uri,
              token,
              logger,
            });

      let servedEnvDb = false;
      const serveDatabase = async (db: string) => {
        if (!quack) return;
        // A legacy .duckdb file takes precedence over the parquet builds, as it
        // did for the old server routes. It is attached once; rebuilds keep
        // writing parquet files but the server stays on the .duckdb file.
        if (envDb) {
          if (servedEnvDb) return;
          servedEnvDb = true;
          await quack.serve(duckDbViews(envDb));
          return;
        }
        // A running server just gets the updated view definitions for the new
        // build; a stopped one is started with them.
        const views = db.endsWith('.parquet') ? parquetViews(db) : duckDbViews(db);
        await quack.serve(views);
      };

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
          await serveDatabase(context.db);
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
      } else {
        // Even without a rebuild, serve whatever build already exists so the
        // app works on a plain `vite dev` after a previous build.
        const initial = envDb ?? (await newestBuild(outDir, name));
        if (initial) void serveDatabase(initial);
        else if (quack) {
          logger.warn(
            `[rebuild-db] no parquet build found under ${displayPath(root, outDir)}; the Quack server will start on the next rebuild`,
          );
        }
      }

      server.httpServer?.on('close', () => quack?.stop());
    },
  };

  // ---------------------------------------------------------------------
  // Always-on plugin: hand the browser the Quack URI and token through a
  // virtual module. Dev values come from the running plugin above; production
  // builds read `QUACK_URI` / `QUACK_TOKEN` from the environment.
  // ---------------------------------------------------------------------
  const configPlugin: Plugin = {
    name: 'quack-config',

    configResolved(config: ResolvedConfig) {
      if (config.command !== 'build') return;
      live.uri = process.env.QUACK_URI ?? live.uri;
      live.token = process.env.QUACK_TOKEN ?? '';
      if (!live.token) {
        config.logger.warn(
          '[quack] QUACK_TOKEN is not set; the production bundle will not be able to authenticate with the Quack server. Set QUACK_URI and QUACK_TOKEN at build time.',
        );
      }
    },

    resolveId(id: string) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_ID;
      return undefined;
    },

    load(id: string) {
      if (id !== RESOLVED_VIRTUAL_ID) return undefined;
      return [
        `/** Generated by rebuild-db. In dev this comes from the running Quack server;`,
        ` * in production builds from QUACK_URI / QUACK_TOKEN. */`,
        `export const quackUri = ${JSON.stringify(live.uri)};`,
        `export const quackToken = ${JSON.stringify(live.token)};`,
        '',
      ].join('\n');
    },
  };

  let root = process.cwd();
  return [servePlugin, configPlugin];
}

// ---------------------------------------------------------------------------
// Quack server: a long-lived DuckDB process serving the database.
// ---------------------------------------------------------------------------

interface QuackServerOptions {
  command: string;
  uri: string;
  token: string;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

/**
 * Keeps a `duckdb` process alive with its stdin held open (the pattern from
 * duckdb's own quack infra: `sleep infinity | duckdb -init init.sql`). SQL is
 * fed to the session as it runs: `quack_serve` at startup, then refreshed
 * `CREATE OR REPLACE VIEW` statements whenever a rebuild produces a new
 * database. Everything the session can see is reachable over Quack.
 */
class QuackServer {
  private child: ChildProcess | null = null;
  private starting = false;
  private stopping = false;
  private file: string | null = null;
  private restartTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: QuackServerOptions) {}

  /** Point the server at `views` (for one database file), starting it if needed. */
  async serve(views: string[]): Promise<void> {
    this.starting = true;
    try {
      if (!this.child || this.child.killed) {
        this.spawn(views);
      } else {
        this.send(views);
      }
      // `quack_serve` binds asynchronously; confirm the endpoint answers so a
      // failed start (extension missing, port taken) is loud in the terminal.
      await this.probe();
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.child?.kill();
    this.child = null;
  }

  private spawn(views: string[]): void {
    const { command, uri, token, logger } = this.options;
    const child = spawn(command, ['-batch', ':memory:'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.stopping = false;

    const forward = (stream: NodeJS.ReadableStream, level: 'info' | 'error') => {
      let buffer = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trimEnd();
          buffer = buffer.slice(newline + 1);
          if (line) logger[level](`[quack] ${line}`);
        }
      });
    };
    forward(child.stdout!, 'info');
    forward(child.stderr!, 'error');

    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (this.stopping || this.starting) return;
      logger.warn(`[quack] the DuckDB server exited (code ${code}); restarting`);
      this.scheduleRestart();
    });
    child.on('error', (error) => {
      logger.error(`[quack] could not run ${command}: ${describe(error)}`);
      this.child = null;
    });

    // Install and load the extension, start serving, then create the views.
    this.send([`INSTALL quack;`, `LOAD quack;`, `CALL quack_serve(${quote(uri)}, token => ${quote(token)});`, ...views]);
    logger.info(`[quack] serving ${uri}`);
  }

  /** Re-run the init SQL for the last database after an unexpected exit. */
  private scheduleRestart(): void {
    if (this.restartTimer || !this.file) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      const views = this.file!.endsWith('.parquet') ? parquetViews(this.file!) : duckDbViews(this.file!);
      void this.serve(views).catch(() => undefined);
    }, 500);
  }

  /** Write SQL statements to the server session's stdin. */
  private send(statements: string[]): void {
    this.file = null;
    for (const statement of statements) {
      // Track the database the views point at so a crashed server can restart
      // with the same data.
      const file = parquetFileOf(statement) ?? duckDbFileOf(statement);
      if (file) this.file = file;
      // The CLI executes a statement once it sees the terminating semicolon;
      // without one, everything after it would be parsed as part of the same
      // statement.
      const terminated = statement.trimEnd().endsWith(';') ? statement : `${statement};`;
      this.child?.stdin?.write(`${terminated}\n`);
    }
  }

  /** Poll the HTTP endpoint until it answers (or give up after a few seconds). */
  private async probe(): Promise<void> {
    const { uri, logger } = this.options;
    const url = quackHttpUrl(uri);
    if (!url) return;
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        const response = await fetch(url, { method: 'OPTIONS' });
        if (response.ok) return;
      } catch {
        // not listening (yet)
      }
      if (Date.now() > deadline) {
        logger.warn(`[quack] ${url} did not answer; check the DuckDB output above`);
        return;
      }
      await delay(250);
    }
  }
}

/** `quack:localhost:9494` -> `http://localhost:9494/quack` (Quack's endpoint). */
function quackHttpUrl(uri: string): string | null {
  const match = /^quack:([^:]+)(?::(\d+))?$/.exec(uri);
  if (!match) return null;
  const port = match[2] ?? '9494';
  return `http://${match[1]}:${port}/quack`;
}

/** The parquet file a view statement reads, if any. */
function parquetFileOf(statement: string): string | null {
  return /read_parquet\('([^']+)'\)/.exec(statement)?.[1] ?? null;
}

/** The .duckdb file an ATTACH statement opens, if any. */
function duckDbFileOf(statement: string): string | null {
  return /^ATTACH '([^']+)'/.exec(statement)?.[1] ?? null;
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function displayPath(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative.startsWith('..') ? file : relative;
}

/** True when `child` is `parent` or lives beneath it. */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** The newest `<name>-*.parquet` build in `dir`, if there is one. */
async function newestBuild(dir: string, name: string): Promise<string | null> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  const files = entries.filter((file) => file.startsWith(`${name}-`) && file.endsWith('.parquet'));
  if (files.length === 0) return null;
  const dated = await Promise.all(files.map(async (file) => ({ file, mtimeMs: (await stat(path.join(dir, file))).mtimeMs })));
  dated.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return path.join(dir, dated[0].file);
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
