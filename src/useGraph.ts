import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Graph } from '../shared/types.ts';

/** One cache entry for the graph assembled from the Quack server's responses. */
export const graphQueryKey = ['quack', 'graph'] as const;

async function fetchGraph(): Promise<Graph> {
  // DuckDB-Wasm only exists in the browser, so the client is imported lazily:
  // server-side rendering never touches it.
  const { loadGraph } = await import('./quack.ts');
  return loadGraph();
}

/**
 * Loads the full lineage graph through TanStack Query, so the Graph and Nodes
 * views share one cached copy. `reload` invalidates that copy and refetches it
 * from the Quack server.
 */
export function useGraph() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: graphQueryKey,
    queryFn: fetchGraph,
    // Quack and DuckDB-Wasm are browser-only; the server render just shows the
    // loading state and the query starts during hydration.
    enabled: typeof window !== 'undefined',
    // The database only changes when the dev plugin rebuilds it, so keep the
    // cached graph until an explicit reload.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: graphQueryKey });
  }, [queryClient]);

  return {
    graph: query.data ?? null,
    error: query.error ? (query.error instanceof Error ? query.error.message : String(query.error)) : null,
    loading: query.isPending || query.isFetching,
    reload,
  };
}
