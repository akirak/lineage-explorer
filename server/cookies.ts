// Cookie helpers for the API routes. The selected database is kept in a
// cookie so each browser can look at a different build of the parquet data.

export const DATABASE_COOKIE = 'lineage_db';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Read one cookie value out of a request's `Cookie` header. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

/** Serialize a `Set-Cookie` header that selects the current database. */
export function databaseCookie(id: string): string {
  return `${DATABASE_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax; HttpOnly`;
}

/** Serialize a `Set-Cookie` header that falls back to the newest database. */
export function clearDatabaseCookie(): string {
  return `${DATABASE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
}
