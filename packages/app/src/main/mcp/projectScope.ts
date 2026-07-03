// Project-scope registry: maps project root <-> per-project URL path token.
// Tokens are derived from a stable per-install salt + the project's canonical
// id (see projectIdFor). ASCII-only (CJS-bundled into Electron main).
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectIdFor } from "@airlock/agent-core";
import {
  projectTokenFrom,
  renderClaudeShim,
  renderMcpConfigJson,
} from "./scopeHelpers";

// A testable factory that owns just the token<->root maps and derivation.
// The module-level singleton delegates to an instance of this.
export function makeScopeRegistry(opts: { installSalt: string }): {
  // Register or return the token for root, optionally using a precomputed
  // projectId to avoid a second realpath call when the caller already has it.
  tokenForRoot(root: string, precomputedProjectId?: string): Promise<string>;
  rootForToken(token: string | null): string | null;
} {
  const tokenToRoot = new Map<string, string>();
  const rootToToken = new Map<string, string>();

  return {
    async tokenForRoot(
      root: string,
      precomputedProjectId?: string,
    ): Promise<string> {
      const cached = rootToToken.get(root);
      if (cached) return cached;
      // Use the precomputed projectId when provided (avoids a double realpath
      // when the caller -- ensureProjectScope -- already resolved it for the dir).
      const projectId = precomputedProjectId ?? (await projectIdFor(root));
      const token = projectTokenFrom(opts.installSalt, projectId);
      tokenToRoot.set(token, root);
      rootToToken.set(root, token);
      return token;
    },
    rootForToken(token: string | null): string | null {
      if (!token) return null;
      return tokenToRoot.get(token) ?? null;
    },
  };
}

// Module-level singleton deps (set via configureScope before first use).
let registry: ReturnType<typeof makeScopeRegistry> | null = null;
let scopeDeps: {
  getServer: () => { port: number; token: string } | null;
  installSalt: string;
  userDataDir: string;
  realClaudeAbs: string | null;
} | null = null;

// Wire the singleton. Call this from index.ts before startMcpServer / any pty
// spawn. Idempotent: a second call replaces the deps and resets the registry so
// token derivation uses the new salt (should not happen in practice).
export function configureScope(deps: {
  getServer: () => { port: number; token: string } | null;
  installSalt: string;
  userDataDir: string;
  realClaudeAbs: string | null;
}): void {
  scopeDeps = deps;
  registry = makeScopeRegistry({ installSalt: deps.installSalt });
}

// Resolve the project root for a request path token. Returns null for unknown
// or absent tokens (caller should refuse with NO_WORKSPACE).
export function rootForToken(token: string | null): string | null {
  return registry?.rootForToken(token) ?? null;
}

// Ensure the per-project shim directory exists, write the mcp-config.json and
// the `claude` shim, chmod it executable, register the token->root mapping, and
// return the bin dir to prepend to PATH.
//
// If the server is not yet up (getServer() returns null), the config is not
// written but the bin dir is still returned -- callers that spawn the shim before
// the server is ready is an edge case; the shim will error at connect time, not
// at PATH-setup time.
export async function ensureProjectScope(
  root: string,
): Promise<{ binDir: string }> {
  if (!scopeDeps || !registry) {
    throw new Error(
      "projectScope: configureScope must be called before ensureProjectScope",
    );
  }
  const { getServer, userDataDir, realClaudeAbs } = scopeDeps;

  // Compute projectId once: used for the dir path AND passed to tokenForRoot so
  // the registry does not call projectIdFor a second time (avoids double realpath).
  const projectId = await projectIdFor(root);
  const token = await registry.tokenForRoot(root, projectId);

  const dir = path.join(userDataDir, "session-mcp", projectId);
  await mkdir(dir, { recursive: true });

  const mcpConfigPath = path.join(dir, "mcp-config.json");
  const shimPath = path.join(dir, "claude");

  const server = getServer();
  if (server) {
    const configJson = renderMcpConfigJson({
      port: server.port,
      projectToken: token,
      accessToken: server.token,
    });
    await writeFile(mcpConfigPath, configJson, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  const shimSh = renderClaudeShim({
    selfDir: dir,
    mcpConfigPath,
    realClaudeAbs: realClaudeAbs ?? "",
  });
  await writeFile(shimPath, shimSh, { encoding: "utf8" });
  await chmod(shimPath, 0o755);

  return { binDir: dir };
}

// Pre-register tokens for already-open roots at startup so rootForToken works
// for in-flight sessions before their first terminal spawn.
export async function seedOpenRoots(roots: string[]): Promise<void> {
  if (!registry) return;
  await Promise.all(roots.map((r) => registry?.tokenForRoot(r)));
}
