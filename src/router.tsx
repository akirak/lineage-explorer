import { createRouter } from '@tanstack/react-router';
import { createQueryClient } from './queryClient.ts';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    context: { queryClient: createQueryClient() },
    scrollRestoration: true,
  });
}
