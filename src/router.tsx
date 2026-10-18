import { createRootRoute, createRoute, createRouter, stripSearchParams } from '@tanstack/react-router';
import App from './App.tsx';
import { defaultSearch, parseSearch } from './search.ts';

const rootRoute = createRootRoute();

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseSearch,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  component: App,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
