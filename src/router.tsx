import { createRootRoute, createRoute, createRouter, stripSearchParams } from '@tanstack/react-router';
import App from './App.tsx';
import NodesPage from './NodesPage.tsx';
import { defaultNodesSearch, defaultSearch, parseNodesSearch, parseSearch } from './search.ts';

const rootRoute = createRootRoute();

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseSearch,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  component: App,
});

const nodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nodes',
  validateSearch: parseNodesSearch,
  search: { middlewares: [stripSearchParams(defaultNodesSearch)] },
  component: NodesPage,
});

const routeTree = rootRoute.addChildren([indexRoute, nodesRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
