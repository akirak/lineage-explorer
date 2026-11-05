import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { rebuildDatabase } from './plugins/rebuild-db.ts';

export default defineConfig({
  plugins: [
    // TanStack Start owns the router and the SSR app. It must run before the
    // React plugin. (The `/api/*` server routes are gone: the data layer now
    // runs in the browser over the Quack remote protocol.)
    tanstackStart(),
    react(),
    // Rebuild the parquet database when the SQL under `data/` changes, serve
    // it over Quack (localhost:9494) while the dev server runs, and inject the
    // Quack URI + token into the browser bundle. Change what is watched with
    // `rebuildDatabase({ dir: '...' })`; configure the server with
    // `rebuildDatabase({ quack: { port: 9494 } })` or disable it with
    // `rebuildDatabase({ quack: false })`.
    ...rebuildDatabase({ buildOnStart: true }),
  ],
});
