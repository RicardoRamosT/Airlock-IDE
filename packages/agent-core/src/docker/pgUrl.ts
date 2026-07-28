// Building a Postgres connection URL for a Docker container from its own env.
//
// The Docker section shows a container's DATABASES AND TABLES, not just its
// name -- the same depth Neon's section gives. That needs credentials, and the
// only place they exist is the container's own environment: the official
// postgres image is configured through POSTGRES_USER / POSTGRES_PASSWORD /
// POSTGRES_DB, which `docker inspect` reports.
//
// The URL this builds is used in MAIN and never crosses IPC -- the same rule
// the Neon API key and vaulted connection strings follow. The renderer only
// ever receives table names and row values.
//
// Everything here is pure: `docker inspect` is one thin call in the caller, so
// the parsing and defaulting rules -- which is where the bugs live -- are
// unit-testable without Docker installed.

// The official image's documented defaults. POSTGRES_USER defaults to
// "postgres"; POSTGRES_DB defaults to the USER, not to "postgres" -- so a
// container run with POSTGRES_USER=app has database "app" unless told
// otherwise. Getting that wrong yields "database does not exist" against a
// server that is working fine.
const DEFAULT_USER = "postgres";

// Parse `docker inspect`'s Config.Env, which is an array of "KEY=value". A
// value may itself contain "=", so split on the FIRST separator only.
export function parseEnvPairs(env: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of env) {
    const i = line.indexOf("=");
    if (i <= 0) continue; // no key, or a leading "=" -- not a usable pair
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/**
 * The Postgres URL for a container, or null when one cannot be built honestly.
 *
 * Null -- rather than a guess -- when there is no published host port (the
 * server is reachable only inside the docker network) or when the container
 * carries no password AND has not opted into trust auth. A URL that cannot
 * connect is worse than admitting we do not have one, because it turns a
 * clear "no credentials" into an opaque connection error.
 */
export function dockerPostgresUrl(
  env: string[],
  hostPort: number | null,
): string | null {
  if (hostPort === null) return null;
  const e = parseEnvPairs(env);
  const user = e.POSTGRES_USER || DEFAULT_USER;
  const password = e.POSTGRES_PASSWORD ?? "";
  // POSTGRES_HOST_AUTH_METHOD=trust makes the server accept any password,
  // including none -- the one case where a missing password is still usable.
  const trusts = e.POSTGRES_HOST_AUTH_METHOD === "trust";
  if (!password && !trusts) return null;
  const database = e.POSTGRES_DB || user;
  // Encode every component: a password may legitimately contain "@", ":" or
  // "/", any of which would otherwise re-partition the URL and point the
  // client at the wrong host.
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgres://${auth}@127.0.0.1:${hostPort}/${encodeURIComponent(database)}`;
}

// The databases on a server, excluding templates and any that reject
// connections. Ordered so the list is stable between refreshes.
export const LIST_DATABASES_SQL =
  "SELECT datname FROM pg_database " +
  "WHERE datallowconn AND NOT datistemplate ORDER BY datname";

// Swap the database on an existing URL, so listing tables in a SECOND database
// on the same server reuses the credentials already discovered rather than
// re-inspecting the container.
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}
