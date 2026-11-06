import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rebuildFromSql } from '../plugins/rebuild-db.ts';

// Rebuild from source, not whichever ignored development build happens to be
// newest. Vite turns the result into a content-hashed, same-origin asset.
const outDir = path.resolve('builds/cloudflare');
await mkdir(outDir, { recursive: true });
await rebuildFromSql(path.resolve('data'), path.join(outDir, 'lineage.parquet'));
console.log('[cloudflare] built database snapshot from data/');

// This is the engine version in the pinned @duckdb/duckdb-wasm package, not
// its npm package version. Host both architectures and both required extensions
// so browsers need no access to DuckDB's extension CDN after deployment.
const engineVersion = 'v1.5.4';
await Promise.all(['wasm_eh', 'wasm_mvp'].flatMap((platform) =>
  ['parquet', 'json'].map(async (extension) => {
    const relative = `${engineVersion}/${platform}/${extension}.duckdb_extension.wasm`;
    const response = await fetch(`https://extensions.duckdb.org/${relative}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`could not download ${relative} (HTTP ${response.status})`);
    const file = path.join(outDir, 'public', 'duckdb-extensions', relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, new Uint8Array(await response.arrayBuffer()));
  }),
));
console.log('[cloudflare] downloaded browser database extensions');
