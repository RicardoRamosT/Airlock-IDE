// Renderer-side validators for the "Add database" modal. These DUPLICATE the
// acceptance rules of agent-core's parseConnString (protocol postgres:/
// postgresql: + a non-empty host) and validateSecretName, intentionally:
// the renderer must NEVER value-import @airlock/agent-core (its barrel pulls
// native deps and breaks the electron-vite browser build -- see CLAUDE.md).
// Keep these in sync with packages/agent-core/src/db/connstr.ts and
// packages/agent-core/src/broker/validators.ts.

/** True if `value` looks like a Postgres connection URL (postgres://host...). */
export function isLikelyPostgresUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return false;
  return u.hostname.length > 0;
}

/** True if `name` is a valid secret name (env-style identifier). */
export function isValidSecretName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
