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
  splitLines,
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
  idleMs?: number,
  // Called with each COMPLETE line of a streamed run, so a caller can report
  // what the CLI is doing while it is still doing it.
  onLine?: (line: string) => void,
) => Promise<string>;

// AN IDLE DEADLINE, not a total one.
//
// This was 15 minutes of WALL CLOCK, and on 2026-08-31 it killed a run that was
// working the whole time: Atlas spent the full quarter hour driving a real
// multi-step task, got SIGKILLed, and the turn was abandoned -- every minute of
// it thrown away. A total cap cannot tell a long job from a stuck one, so it has
// to be set either too low to finish real work or too high to catch a wedge.
//
// What actually distinguishes them is OUTPUT. `--output-format stream-json`
// emits an event per step (estimated_tokens deltas arrive continuously, verified
// against the CLI on 2026-08-31), so a live run is never quiet for long and a
// wedged one -- a dropped connection it keeps retrying -- is quiet immediately.
// The timer therefore resets on every chunk, and only silence ends a run.
//
// The brief composer still uses --output-format json, which prints once at the
// end, so it would trip an idle timer instantly. It passes its own total budget
// instead; see idleMs below.
export const SPAWN_IDLE_MS = 5 * 60 * 1000;

// The old total cap, kept ONLY for the non-streaming brief path.
export const SPAWN_TIMEOUT_MS = 15 * 60 * 1000;

export function spawnClaude(
  args: string[],
  stdin: string,
  signal?: AbortSignal,
  // How long the CLI may be SILENT before it is treated as wedged. Callers on
  // a streaming format leave this at the default; the brief, which prints only
  // at the end, passes its total budget.
  idleMs: number = SPAWN_IDLE_MS,
  onLine?: (line: string) => void,
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
    // Declared BEFORE the stream handlers that call it: `const` is in a
    // temporal dead zone until its initialiser runs, and a handler referencing
    // it earlier only works by accident of event timing.
    let timedOut = false;
    let deadline: ReturnType<typeof setTimeout>;
    const arm = () => {
      deadline = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, idleMs);
      deadline.unref?.(); // never hold up quitting
    };
    // Every chunk proves the run is alive, so the clock starts over. Cheap
    // enough per chunk: one clearTimeout plus one setTimeout.
    const beat = () => {
      clearTimeout(deadline);
      arm();
    };
    arm();
    child.stdout.setEncoding("utf8");
    // Complete lines only: a chunk boundary can fall mid-JSON, and handing a
    // partial line to a parser drops events at random.
    let pending = "";
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      beat();
      if (!onLine) return;
      const { lines, rest } = splitLines(pending + chunk);
      pending = rest;
      for (const line of lines) onLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Bounded: a runaway process must not grow this without limit.
      if (err.length < 4000) err += chunk;
      // Reset on stderr too: a run that is only logging warnings is still a
      // run, and killing it would be the same mistake in a new place.
      beat();
    });
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(`spawn claude failed: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      // Checked with the abort, and for the same reason: a killed run can leave
      // partial JSON on stdout that the fallback below would happily accept.
      if (timedOut) {
        reject(
          new Error(
            `claude produced no output for ${Math.round(idleMs / 60000)} minutes and was stopped`,
          ),
        );
        return;
      }
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
    // --output-format json emits nothing until it is done, so "idle" and
    // "total" are the same thing here: pass the old 15-minute budget rather
    // than let it inherit the streaming default and die at 5.
    const raw = await spawnFn(
      buildComposerArgs(model),
      prompt,
      undefined,
      SPAWN_TIMEOUT_MS,
    );
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
