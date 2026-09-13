// ASCII comments only. One small `claude` call per project that has memory to
// distil.
//
// The flags come from buildComposerArgs, which already takes its system prompt
// as a parameter precisely so a second caller could reuse the identical cost
// shape. compose.ts measured that shape: ~31K context by default, ~21K with
// --strict-mcp-config, ~13K with no tools and an own system prompt. Do not
// re-roll these flags here; a drift between the two callers is a silent cost
// regression.
//
// Never throws. A wedged or lying reporter costs its project a narrative
// sentence, never the debrief.
import {
  buildComposerArgs,
  buildReportPrompt,
  COMPOSER_MODEL,
  type CodeLedger,
  type ProjectReport,
  parseComposerOutput,
  parseReport,
  REPORTER_SYSTEM_PROMPT,
  type SessionDigest,
} from "@airlock/agent-core";
import { emitEvent } from "../eventlog/wire";
import type { SpawnFn } from "./composer";

export interface ReporterJob {
  ledger: CodeLedger;
  digests: SessionDigest[];
}

// Small answers over small prompts. A reporter that has not printed in two
// minutes is wedged, not thinking: --output-format json prints only at the end,
// so this is a TOTAL budget, the same reasoning as runComposer's.
export const REPORTER_BUDGET_MS = 2 * 60 * 1000;
export const REPORTER_CONCURRENCY = 3;

async function runOne(
  spawn: SpawnFn,
  job: ReporterJob,
  signal?: AbortSignal,
): Promise<ProjectReport | null> {
  try {
    const raw = await spawn(
      buildComposerArgs(COMPOSER_MODEL, REPORTER_SYSTEM_PROMPT),
      buildReportPrompt(job.ledger, job.digests),
      signal,
      REPORTER_BUDGET_MS,
    );
    const envelope = parseComposerOutput(raw);
    if (envelope === null) return null;
    const report = parseReport(job.ledger.root, envelope.text);
    if (report === null) {
      emitEvent({
        level: "warn",
        category: "atlas",
        op: "atlas.report",
        outcome: "error",
        detail: { root: job.ledger.root, reason: "unparseable report" },
      });
    }
    return report;
  } catch (e) {
    emitEvent({
      level: "warn",
      category: "atlas",
      op: "atlas.report",
      outcome: "error",
      detail: {
        root: job.ledger.root,
        reason: e instanceof Error ? e.message : String(e),
      },
    });
    return null;
  }
}

export async function runReporters(
  spawn: SpawnFn,
  jobs: readonly ReporterJob[],
  signal?: AbortSignal,
): Promise<ProjectReport[]> {
  const out: (ProjectReport | null)[] = new Array(jobs.length).fill(null);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(REPORTER_CONCURRENCY, jobs.length) },
    async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= jobs.length) return;
        out[i] = await runOne(spawn, jobs[i] as ReporterJob, signal);
      }
    },
  );
  await Promise.all(workers);
  return out.filter((r): r is ProjectReport => r !== null);
}
