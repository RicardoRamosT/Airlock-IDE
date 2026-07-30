// ASCII-only by design: this file is CJS-bundled into Electron main and
// Electron's cjs_lexer crashes on multibyte chars, so no smart punctuation in
// any regex, string literal, or comment in this file.
//
// SESSION-scoped secret store: values the agent FETCHED itself via
// capture_secret. Deliberately in-memory ONLY -- never the keychain, never disk.
// That is the security property: injectInto feeds every VAULTED secret to every
// terminal in the project (including the dev server), so a captured prod
// credential must never become a vault entry. It dies with the app.

export interface SessionSecretMeta {
  name: string;
  bytes: number;
  capturedAt: string; // ISO
  command: string; // what fetched it, for the audit trail and the UI
}

interface Entry {
  value: string;
  meta: SessionSecretMeta;
}

// root -> name -> entry. Keyed by ROOT (not window) so a project tear-off
// between windows keeps working; both windows are one process.
const store = new Map<string, Map<string, Entry>>();

export function putSessionSecret(
  root: string,
  name: string,
  value: string,
  command: string,
  nowIso?: string,
): SessionSecretMeta {
  const meta: SessionSecretMeta = {
    name,
    bytes: Buffer.byteLength(value, "utf8"),
    capturedAt: nowIso ?? new Date().toISOString(),
    command,
  };
  let forRoot = store.get(root);
  if (!forRoot) {
    forRoot = new Map<string, Entry>();
    store.set(root, forRoot);
  }
  forRoot.set(name, { value, meta });
  return meta;
}

export function getSessionSecretValue(
  root: string,
  name: string,
): string | null {
  return store.get(root)?.get(name)?.value ?? null;
}

export function hasSessionSecret(root: string, name: string): boolean {
  return store.get(root)?.has(name) ?? false;
}

// Metadata only -- safe to surface to the agent.
export function listSessionSecretNames(root: string): SessionSecretMeta[] {
  return [...(store.get(root)?.values() ?? [])].map((e) => e.meta);
}

// Value gather for the redaction set. VALUE-RETURNING: never reference this from
// mcp/tools.ts (the source guard forbids it).
export function sessionSecretValues(root: string): string[] {
  return [...(store.get(root)?.values() ?? [])].map((e) => e.value);
}

export function clearSessionSecrets(root?: string): void {
  if (root === undefined) store.clear();
  else store.delete(root);
}
