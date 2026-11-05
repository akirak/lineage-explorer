import { useCallback, useEffect, useState } from 'react';
import type { Graph } from '../shared/types.ts';

/** Loads the full lineage graph once per mount and exposes a manual reload. */
export function useGraph() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // DuckDB-Wasm only exists in the browser, so the client is imported
      // lazily: server-side rendering never touches it.
      const { loadGraph } = await import('./quack.ts');
      setGraph(await loadGraph());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { graph, error, loading, reload };
}
