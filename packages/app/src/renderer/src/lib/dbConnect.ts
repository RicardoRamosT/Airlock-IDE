// Renderer-side validators for the "Add database" modal. These DUPLICATE the
// acceptance rules of agent-core's validateSecret (postgres-url provider:
// requires postgres(ql)://user:password@host) and validateSecretName,
// intentionally: the renderer must NEVER value-import @airlock/agent-core
// (its barrel pulls native deps and breaks the electron-vite browser build --
// see CLAUDE.md). Keep these in sync with
// packages/agent-core/src/broker/validators.ts (the postgres-url provider
// pattern is the binding rule: db:list filters on that tag, so a
// credential-less URL would vault but never appear in the Databases list).

/**
 * True if `value` looks like a Postgres connection URL WITH embedded
 * credentials (postgres://user:password@host...). Credentials are required to
 * match agent-core's `postgres-url` provider rule (validators.ts): that tag is
 * what db:list filters on, so a credential-less URL would vault but never
 * appear in the Databases list. Keeping this in sync avoids that silent failure.
 */
export function isLikelyPostgresUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return false;
  return (
    u.hostname.length > 0 && u.username.length > 0 && u.password.length > 0
  );
}

/** True if `name` is a valid secret name (env-style identifier). */
export function isValidSecretName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
