import { useCallback, useEffect, useState } from 'react';
import type { Graph } from '../shared/types.ts';
import { fetchGraph } from './api.ts';

/** Loads the full lineage graph once per mount and exposes a manual reload. */
export function useGraph() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGraph(await fetchGraph());
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
