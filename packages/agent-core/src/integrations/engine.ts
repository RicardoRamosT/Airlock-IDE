// packages/agent-core/src/integrations/engine.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mapToItems } from "./map";
import type { IntegrationItem, IntegrationManifest } from "./manifest";

const exec = promisify(execFile);

// DI-able runner (mirrors docker.ts / github/ci.ts). The real one shells out
// via execFile -- NO shell, so args are passed safely -- with a timeout so a
// slow tool never stalls the Activity feed.
export type CliRunner = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number },
) => Promise<string>;

const realRunner: CliRunner = async (cmd, args, { cwd, timeoutMs }) => {
  const { stdout } = await exec(cmd, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
};

// Run ONE manifest: detect (authCheck exit 0) -> poll -> JSON.parse -> map.
// Any failure (tool missing, not authed, timeout, non-JSON) yields [] so the
// feed degrades silently, exactly like the gh/render/docker blocks.
export async function runManifest(
  m: IntegrationManifest,
  root: string | null,
  run: CliRunner = realRunner,
): Promise<IntegrationItem[]> {
  const cwd = m.poll.cwdScoped ? (root ?? undefined) : undefined;
  const timeoutMs = m.poll.timeoutMs ?? 8000;
  try {
    await run(m.detect.authCheck.cmd, m.detect.authCheck.args, { cwd, timeoutMs });
  } catch {
    return []; // not installed or not authenticated
  }
  let out: string;
  try {
    out = await run(m.poll.cli.cmd, m.poll.cli.args, { cwd, timeoutMs });
  } catch {
    return [];
  }
  let json: unknown;
  try {
    json = JSON.parse(out);
  } catch {
    return [];
  }
  return mapToItems(m, json);
}
