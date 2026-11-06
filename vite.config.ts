import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { rebuildDatabase } from './plugins/rebuild-db.ts';
import { compressedWasm } from './plugins/compressed-wasm.ts';

export default defineConfig(({ mode }) => ({
  publicDir: mode === 'cloudflare' ? 'builds/cloudflare/public' : 'public',
  plugins: [
    // TanStack Start owns the router and the SSR app. It must run before the
    // React plugin. (The `/api/*` server routes are gone: the data layer now
    // runs in the browser over the Quack remote protocol.)
    // The Cloudflare deployment is an assets-only SPA. Generate index.html
    // as its shell so deep links can use Cloudflare's SPA fallback.
    tanstackStart(mode === 'cloudflare' ? {
      spa: { enabled: true, prerender: { outputPath: '/index' } },
    } : {}),
    react(),
    ...(mode === 'cloudflare' ? [compressedWasm()] : []),
    // Rebuild the parquet database when the SQL under `data/` changes, serve
    // it over Quack (localhost:9494) while the dev server runs, and inject the
    // Quack URI + token into the browser bundle. Change what is watched with
    // `rebuildDatabase({ dir: '...' })`; configure the server with
    // `rebuildDatabase({ quack: { port: 9494 } })` or disable it with
    // `rebuildDatabase({ quack: false })`.
    ...rebuildDatabase({
      buildOnStart: true,
      snapshot: mode === 'cloudflare' ? 'builds/cloudflare/lineage.parquet' : undefined,
    }),
  ],
}));
