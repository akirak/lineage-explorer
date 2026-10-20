import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { rebuildDatabase } from './plugins/rebuild-db.ts';

export default defineConfig({
  // The API routes import a server-only data layer that pulls in the native
  // DuckDB bindings. They are never part of the client bundle, but Vite's dev
  // dependency optimizer follows the import graph and chokes on the `.node`
  // binary, so keep it out of the optimizer.
  optimizeDeps: {
    exclude: ['@duckdb/node-api'],
  },
  plugins: [
    // TanStack Start owns the router, the SSR app, and the `/api/*` server
    // routes. It must run before the React plugin.
    tanstackStart(),
    react(),
    // Rebuild the parquet database when the SQL under `data/` changes. Change
    // the directory with `rebuildDatabase({ dir: '...' })`.
    rebuildDatabase({ buildOnStart: true }),
  ],
});
