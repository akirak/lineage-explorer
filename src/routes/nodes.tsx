import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import NodesPage from '../NodesPage.tsx';
import { defaultNodesSearch, parseNodesSearch } from '../search.ts';

export const Route = createFileRoute('/nodes')({
  validateSearch: parseNodesSearch,
  search: { middlewares: [stripSearchParams(defaultNodesSearch)] },
  component: NodesPage,
});
