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
import { homedir } from "node:os";
import {
  buildComposerArgs,
  type ComposerResult,
  parseComposerOutput,
} from "@airlock/agent-core";
import { emitEvent } from "../eventlog/wire";

// A deliberate stop, not a failure. Callers use this to keep a user pressing
// Escape out of the error log.
export const CANCELLED = "atlas: cancelled";

export type SpawnFn = (
  args: string[],
  stdin: string,
  // Stopping a run has to KILL the CLI, not merely stop awaiting it: an
  // abandoned `claude` keeps working and keeps spending quota with nowhere to
  // deliver its answer.
  signal?: AbortSignal,
) => Promise<string>;

export function spawnClaude(
  args: string[],
  stdin: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(CANCELLED));
      return;
    }
    // stderr is CAPTURED, not ignored. It was ignored, so a failing run gave
    // the user "Could not reach Claude" and left nobody -- including the logs
    // -- any way to find out why.
    // Explicit cwd: a Finder-launched app inherits an arbitrary working
    // directory (often "/"), and the home directory is a stable, predictable
    // place to run from. Project access comes from --add-dir, not from cwd.
    const child = spawn("claude", args, {
      cwd: homedir(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Bounded: a runaway process must not grow this without limit.
      if (err.length < 4000) err += chunk;
    });
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(`spawn claude failed: ${e.message}`));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      // Checked FIRST: a killed run can leave partial JSON on stdout, and
      // `out.includes("{")` below would happily resolve with that garbage.
      if (signal?.aborted) {
        reject(new Error(CANCELLED));
        return;
      }
      if (code === 0 || out.includes("{")) {
        resolve(out);
        return;
      }
      reject(
        new Error(
          `claude exited ${code ?? "?"}${err.trim() ? `: ${err.trim().slice(0, 500)}` : " with no output"}`,
        ),
      );
    });
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
    const raw = await spawnFn(buildComposerArgs(model), prompt);
    const parsed = parseComposerOutput(raw);
    if (parsed === null) {
      emitEvent({
        level: "error",
        category: "atlas",
        op: "atlas.compose",
        outcome: "error",
        detail: { reason: "unparseable output", head: raw.slice(0, 300) },
      });
    }
    return parsed;
  } catch (e) {
    emitEvent({
      level: "error",
      category: "atlas",
      op: "atlas.compose",
      outcome: "error",
      detail: { reason: e instanceof Error ? e.message : String(e) },
    });
    return null;
  }
}
