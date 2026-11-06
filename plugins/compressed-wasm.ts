import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/**
 * DuckDB's raw WASM modules exceed Cloudflare's 25 MiB per-asset limit.
 * Publish gzip files (~8–9 MiB), inflated explicitly by the browser client.
 * Unlike Content-Encoding overrides, this also works in a plain preview server.
 */
export function compressedWasm(): Plugin {
  const prefix = '\0compressed-wasm:';
  return {
    name: 'compressed-wasm',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('.wasm?url')) return;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (resolved) return prefix + resolved.id.slice(0, -'?url'.length);
    },
    async load(id) {
      if (!id.startsWith(prefix)) return;
      const file = id.slice(prefix.length);
      this.addWatchFile(file);
      const reference = this.emitFile({
        type: 'asset',
        name: `${path.basename(file)}.gz`,
        source: gzipSync(await readFile(file)),
      });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
  };
}
