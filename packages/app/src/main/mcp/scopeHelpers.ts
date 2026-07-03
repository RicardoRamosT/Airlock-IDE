// Pure helpers for per-session MCP scoping. ASCII-only (CJS-bundled into main).
import { createHmac } from "node:crypto";

// First positional in this set => a `claude` management invocation; do NOT inject
// --mcp-config (it would perturb `claude mcp`, `claude config`, etc.).
export const SHIM_PASSTHROUGH_SUBCOMMANDS = [
  "mcp",
  "config",
  "doctor",
  "update",
  "install",
  "migrate-installer",
  "setup-token",
];
// These flags also mean "do not inject" (version/help short-circuits).
export const SHIM_PASSTHROUGH_FLAGS = ["--version", "-v", "--help", "-h"];

// Decide whether the shim should append --mcp-config for this argv. Scans for the
// first positional: a passthrough subcommand or version/help => false; otherwise
// (incl. bare `claude`, -p, --continue, --resume) => true. SOURCE OF TRUTH for the
// shell case rendered in renderClaudeShim (kept in sync via the shared consts).
export function shimShouldInject(args: string[]): boolean {
  for (const a of args) {
    if (SHIM_PASSTHROUGH_FLAGS.includes(a)) return false;
    if (a === "--") return true;
    if (a.startsWith("-")) continue;
    return !SHIM_PASSTHROUGH_SUBCOMMANDS.includes(a);
  }
  return true;
}

// Deterministic per-project token (stable across app runs given the same salt+id).
export function projectTokenFrom(
  installSalt: string,
  projectId: string,
): string {
  return createHmac("sha256", installSalt)
    .update(projectId)
    .digest("hex")
    .slice(0, 32);
}

// The per-project --mcp-config payload: airlock http server at the project's path
// token, access-gated by the global bearer.
export function renderMcpConfigJson(o: {
  port: number;
  projectToken: string;
  accessToken: string;
}): string {
  return JSON.stringify({
    mcpServers: {
      airlock: {
        type: "http",
        url: `http://127.0.0.1:${o.port}/mcp/${o.projectToken}`,
        headers: { Authorization: `Bearer ${o.accessToken}` },
      },
    },
  });
}

// The generated POSIX-sh `claude` shim. Finds the real claude on PATH minus its
// own dir (recursion guard), falls back to a baked absolute path, then injects
// --mcp-config for session launches (mirrors shimShouldInject via the shared
// subcommand/flag lists). ASCII-only.
export function renderClaudeShim(o: {
  selfDir: string;
  mcpConfigPath: string;
  realClaudeAbs: string;
}): string {
  const subs = SHIM_PASSTHROUGH_SUBCOMMANDS.join("|");
  const flags = SHIM_PASSTHROUGH_FLAGS.join("|");
  return `#!/bin/sh
# AirLock per-project claude shim (generated; regenerated on terminal spawn).
# Scopes this terminal's claude to THIS project's MCP endpoint so secrets/tools
# follow the session, not GUI focus.
SELF_DIR='${o.selfDir}'
MCP_CONFIG='${o.mcpConfigPath}'

real=''
OLDIFS="$IFS"
IFS=':'
for d in $PATH; do
  [ "$d" = "$SELF_DIR" ] && continue
  if [ -x "$d/claude" ]; then real="$d/claude"; break; fi
done
IFS="$OLDIFS"
[ -z "$real" ] && real='${o.realClaudeAbs}'
[ -z "$real" ] && { echo "airlock: claude not found on PATH" >&2; exit 127; }

inject=1
for a in "$@"; do
  case "$a" in
    ${flags}) inject=0; break ;;
    --) break ;;
    ${subs}) inject=0; break ;;
    -*) ;;
    *) break ;;
  esac
done

if [ "$inject" -eq 1 ]; then
  exec "$real" --mcp-config "$MCP_CONFIG" "$@"
else
  exec "$real" "$@"
fi
`;
}

// Session ids (pty ids) owned by `root`. Empty when root is null (no project).
export function sessionsForRoot(
  sessionRoots: Map<string, string>,
  root: string | null,
): string[] {
  if (!root) return [];
  const out: string[] = [];
  for (const [id, r] of sessionRoots) if (r === root) out.push(id);
  return out;
}
