// ASCII comments only. Spawn `claude` and hand back a parsed brief.
//
// The prompt goes on STDIN. A portfolio brief can be tens of kilobytes and
// argv is not the place for it.
//
// DOCK SAFETY (spec section 11): print mode fires neither AirLock's statusLine
// nor its hooks -- verified 2026-08-30 by running a headless call and observing
// that no new file appeared in dockstatus/live/ or dockstatus/sessions/. So
// Atlas cannot move the dock badge and needs no exclusion mechanism. That is an
// observed CLI behaviour rather than a guarantee; if a future Claude Code fires
// hooks in print mode, this is the file to revisit.

import { spawn } from "node:child_process";
import {
  buildComposerArgs,
  type ComposerResult,
  parseComposerOutput,
} from "@airlock/agent-core";

export type SpawnFn = (args: string[], stdin: string) => Promise<string>;

export function spawnClaude(args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", () => resolve(out));
    child.stdin.on("error", reject);
    child.stdin.end(stdin);
  });
}

// Never throws. A failed compose must leave yesterday's brief in place rather
// than replace it with nothing.
export async function runComposer(
  spawnFn: SpawnFn,
  prompt: string,
  model?: string,
): Promise<ComposerResult | null> {
  try {
    return parseComposerOutput(await spawnFn(buildComposerArgs(model), prompt));
  } catch {
    return null;
  }
}
