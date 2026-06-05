import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface McpRegisterInput {
  root: string;
  url: string;
  token: string;
  name?: string;
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

export async function registerMcpServer(
  input: McpRegisterInput,
  run: ClaudeRunner = realClaude,
): Promise<McpRegisterResult> {
  const name = input.name ?? "airlock";
  const args = [
    "mcp",
    "add",
    "--transport",
    "http",
    name,
    input.url,
    "--scope",
    "local",
    "--header",
    `Authorization: Bearer ${input.token}`,
  ];
  try {
    await run(args, input.root);
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
