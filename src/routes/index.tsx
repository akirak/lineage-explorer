import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import App from '../App.tsx';
import { defaultSearch, parseSearch } from '../search.ts';

export const Route = createFileRoute('/')({
  validateSearch: parseSearch,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  component: App,
});
