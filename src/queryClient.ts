import { QueryClient } from '@tanstack/react-query';

/** Router context carrying the TanStack Query client to every route. */
export interface RouterContext {
  queryClient: QueryClient;
}

export function createQueryClient(): QueryClient {
  // A fresh client per router keeps the SSR side isolated; all Quack queries
  // are browser-only, so the cache only fills in the client.
  return new QueryClient();
}
