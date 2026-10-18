import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rebuildDatabase } from './plugins/rebuild-db.ts';

export default defineConfig({
  // Rebuild the DuckDB file when the SQL under `data/` changes. Change the
  // directory with `rebuildDatabase({ dir: '...' })`.
  plugins: [react(), rebuildDatabase()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
});
