export interface DbInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  redacted: string; // safe to show: password replaced with ***
}

/**
 * Parse a Postgres connection string into display fields, with the password
 * redacted. Returns null for anything not a postgres URL. The WHATWG URL parser
 * handles postgres:// and postgresql://.
 */
export function parseConnString(url: string): DbInfo | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return null;
  const host = u.hostname;
  if (!host) return null;
  const port = u.port ? Number(u.port) : 5432;
  const database =
    decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const user = decodeURIComponent(u.username) || "";
  const auth = user ? `${user}:***@` : "";
  const portPart = u.port ? `:${u.port}` : "";
  const redacted = `${u.protocol}//${auth}${host}${portPart}/${database}`;
  return { host, port, database, user, redacted };
}
