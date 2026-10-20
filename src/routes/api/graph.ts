import { createFileRoute } from '@tanstack/react-router';
import type { ApiError } from '../../../shared/types.ts';
import { DATABASE_COOKIE, readCookie } from '../../../server/cookies.ts';
import { buildGraph } from '../../../server/lineage.ts';

export const Route = createFileRoute('/api/graph')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const graph = await buildGraph(readCookie(request, DATABASE_COOKIE));
          return Response.json(graph);
        } catch (error) {
          console.error(error);
          return Response.json({ error: describe(error) } satisfies ApiError, { status: 500 });
        }
      },
    },
  },
});

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
