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

// Match scheme://userinfo@ inside arbitrary text. The userinfo run stops at the
// first @, whitespace, or slash so the host stays intact. ASCII-only by design:
// this file is CJS-bundled into Electron main and Electron's cjs_lexer crashes
// on multibyte chars, so no smart punctuation in this regex or its comments.
const CONNSTR_USERINFO_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@\s/]*@/g;

/**
 * Redact the userinfo (user and/or password) from every scheme://user:pw@host
 * URI found in arbitrary text, replacing it with ***. Scheme and host are left
 * intact. Defense-in-depth so a driver/DNS error that echoes a full connection
 * string cannot leak the password across IPC, regardless of pg internals.
 */
export function redactConnStrings(text: string): string {
  return text.replace(CONNSTR_USERINFO_RE, "$1***@");
}
