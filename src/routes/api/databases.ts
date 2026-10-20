import { createFileRoute } from '@tanstack/react-router';
import type { DatabasesResponse } from '../../../shared/types.ts';
import { DATABASE_COOKIE, clearDatabaseCookie, databaseCookie, readCookie } from '../../../server/cookies.ts';
import { currentDatabaseId, listDatabases } from '../../../server/lineage.ts';

export const Route = createFileRoute('/api/databases')({
  server: {
    handlers: {
      // Every parquet build the explorer can serve, plus the one this browser
      // currently has selected (from the cookie, or the newest build).
      GET: async ({ request }) => {
        const databases = await listDatabases();
        const current = await currentDatabaseId(readCookie(request, DATABASE_COOKIE));
        return Response.json({ databases, current: current ?? null } satisfies DatabasesResponse);
      },

      // Remember the chosen database in a cookie so the UI can switch builds.
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { id?: unknown };
        const databases = await listDatabases();
        if (typeof body.id !== 'string' || !databases.some((database) => database.id === body.id)) {
          return Response.json({ error: 'Unknown database' }, { status: 400 });
        }
        return Response.json(
          { databases, current: body.id } satisfies DatabasesResponse,
          { headers: { 'Set-Cookie': databaseCookie(body.id) } },
        );
      },

      // Forget the selection so the next request uses the newest revision.
      DELETE: async () => {
        const databases = await listDatabases();
        const current = await currentDatabaseId();
        return Response.json(
          { databases, current: current ?? null } satisfies DatabasesResponse,
          { headers: { 'Set-Cookie': clearDatabaseCookie() } },
        );
      },
    },
  },
});
