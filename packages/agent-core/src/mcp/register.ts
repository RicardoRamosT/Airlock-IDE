import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type McpScope = "local" | "user";

export interface McpRegisterInput {
  url: string;
  token: string;
  name?: string;
  // Default "user": registers in the user's global claude config so EVERY
  // claude session on the machine loads it (zero per-project setup). Use "local"
  // to key it to a single project dir (cwd) instead.
  scope?: McpScope;
  // Where to run the `claude` CLI. Only meaningful for "local" scope (which
  // writes to that project's config); defaults to the process cwd otherwise.
  cwd?: string;
}
export interface McpUnregisterInput {
  name?: string;
  scope?: McpScope;
  cwd?: string;
}
export type McpRegisterResult =
  | { ok: true; alreadyExists?: boolean }
  | { ok: false; reason: "not_found" | "error"; message?: string };

// DI runner: (argv, cwd) -> stdout. Real impl shells out to the claude CLI.
export type ClaudeRunner = (args: string[], cwd: string) => Promise<string>;

const realClaude: ClaudeRunner = async (args, cwd) => {
  const { stdout } = await exec("claude", args, {
    cwd,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
};

// Register airlock's MCP server with the `claude` CLI (default USER scope, so it
// is native to every claude session with no per-project setup). Idempotent: an
// already-registered server counts as success.
export async function registerMcpServer(
  input: McpRegisterInput,
  run: ClaudeRunner = realClaude,
): Promise<McpRegisterResult> {
  const name = input.name ?? "airlock";
  const scope = input.scope ?? "user";
  const args = [
    "mcp",
    "add",
    "--transport",
    "http",
    name,
    input.url,
    "--scope",
    scope,
    "--header",
    `Authorization: Bearer ${input.token}`,
  ];
  try {
    await run(args, input.cwd ?? process.cwd());
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message?: string };
    if (e.code === "ENOENT") return { ok: false, reason: "not_found" };
    const raw = e.stderr || e.message || "claude mcp add failed";
    // Never echo the bearer token in a surfaced error.
    const msg = input.token ? raw.split(input.token).join("***") : raw;
    if (/already exists|already configured/i.test(msg)) {
      return { ok: true, alreadyExists: true };
    }
    return { ok: false, reason: "error", message: msg };
  }
}

// Remove a previously-registered server (default USER scope). Idempotent +
// best-effort: nothing-to-remove counts as success, so a clean quit-time
// teardown never errors even if registration never ran.
export async function unregisterMcpServer(
  input: McpUnregisterInput = {},
  run: ClaudeRunner = realClaude,
): Promise<McpRegisterResult> {
  const name = input.name ?? "airlock";
  const scope = input.scope ?? "user";
  const args = ["mcp", "remove", name, "--scope", scope];
  try {
    await run(args, input.cwd ?? process.cwd());
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message?: string };
    if (e.code === "ENOENT") return { ok: false, reason: "not_found" };
    const raw = e.stderr || e.message || "claude mcp remove failed";
    // Removing a server that is not registered is fine (idempotent teardown).
    if (/no .*(server|mcp)|not found|does not exist|no such/i.test(raw)) {
      return { ok: true };
    }
    return { ok: false, reason: "error", message: raw };
  }
}
