import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import { build } from 'vite';
import { compressedWasm } from '../plugins/compressed-wasm.ts';
import { rebuildFromSql } from '../plugins/rebuild-db.ts';
import { graphQueries } from '../shared/queries.ts';
import { schema } from '../shared/schema.ts';
import { parquetViews, schemaTables } from '../shared/views.ts';
import { checkCloudflareAssets } from './check-cloudflare-assets.ts';

test('Cloudflare snapshot supports every graph query without a Quack server', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lineage-snapshot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Include a quote to exercise SQL path escaping too.
  const snapshot = path.join(dir, "lineage's.parquet");
  await rebuildFromSql(path.resolve('data'), snapshot);
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  try {
    for (const sql of parquetViews(snapshot)) await conn.run(sql);
    const tables = schemaTables();
    const queries = graphQueries({
      job: new Set(tables.get(schema.job.table)),
      dataset: new Set(tables.get(schema.dataset.table)),
      output: new Set(tables.get(schema.output.table)),
    });
    for (const [name, sql] of Object.entries(queries)) {
      const rows = (await conn.runAndReadAll(sql)).getRowObjectsJson();
      assert.ok(rows.length > 0, `${name} returned no rows`);
      if (name === 'writes') assert.ok(rows.some((row) => row.crud === 'D'));
    }
  } finally {
    conn.closeSync();
    db.closeSync();
  }
});

test('WASM assets are compressed before upload and URL imports point at gzip files', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lineage-wasm-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const raw = Buffer.alloc(26 * 1024 * 1024);
  await writeFile(path.join(dir, 'large.wasm'), raw);
  await writeFile(path.join(dir, 'main.js'), "import wasm from './large.wasm?url'; export default wasm;");
  await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    plugins: [compressedWasm()],
    build: {
      outDir: 'dist',
      lib: { entry: path.join(dir, 'main.js'), formats: ['es'], fileName: 'main' },
    },
  });
  const assets = await readdir(path.join(dir, 'dist'));
  const gzipFile = assets.find((file) => file.endsWith('.gz'));
  assert.ok(gzipFile, 'expected a compressed WASM asset');
  assert.ok(!assets.some((file) => file.endsWith('.wasm')), 'raw WASM must not be uploaded');
  const compressed = await readFile(path.join(dir, 'dist', gzipFile));
  assert.ok(compressed.length < 25 * 1024 * 1024);
  assert.deepEqual(gunzipSync(compressed), raw);
  const entry = assets.find((file) => /^main\.(m?js)$/.test(file));
  assert.ok(entry, 'expected the generated JavaScript entry');
  assert.match(await readFile(path.join(dir, 'dist', entry), 'utf8'), /\.gz/);
});

test('asset validation requires a SPA shell and enforces the uncompressed upload size', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lineage-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(checkCloudflareAssets(dir), /index\.html/);
  await writeFile(path.join(dir, 'index.html'), '<!doctype html>');
  await mkdir(path.join(dir, 'assets'));
  const file = await open(path.join(dir, 'assets', 'test.wasm'), 'w');
  try {
    await file.truncate(25 * 1024 * 1024);
    await checkCloudflareAssets(dir);
    await file.truncate(25 * 1024 * 1024 + 1);
    await assert.rejects(checkCloudflareAssets(dir), /25 MiB/);
  } finally {
    await file.close();
  }
});
