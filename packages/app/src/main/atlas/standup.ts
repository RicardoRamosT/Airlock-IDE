// ASCII comments only. The step between refreshing the portfolio and composing
// the debrief: every project files a report.
//
// The budget rule lives here. A reporter exists to distil MEMORY, not to state
// facts: a project with commits but no Claude session gets no model call,
// because "3 commits, PR #12 merged, CI green" is already prose. The CLI floor
// is ~13K per call even with every flag stripped, so six needless calls is 78K
// of pure overhead.
import {
  type CodeLedger,
  type DebriefWindow,
  ledgerIsQuiet,
  type ProjectReport,
  type SessionDigest,
} from "@airlock/agent-core";
import type { ReporterJob } from "./reporters";

export interface StandupDeps {
  ledger(root: string, window: DebriefWindow): Promise<CodeLedger>;
  digests(root: string, window: DebriefWindow): Promise<SessionDigest[]>;
  report(jobs: ReporterJob[], signal: AbortSignal): Promise<ProjectReport[]>;
}

// The debrief is what the user is waiting for. Reporters that have not
// answered by this point are abandoned and their projects degrade to ledgers
// (G5) rather than holding up the morning. The signal reaches spawnClaude,
// which SIGTERMs the child -- an abandoned `claude` would otherwise keep
// running and keep spending quota with nowhere to deliver its answer.
export const STANDUP_DEADLINE_MS = 3 * 60 * 1000;

export interface StandupResult {
  reports: ProjectReport[];
  ledgers: CodeLedger[]; // every non-quiet project, reporter or not
  quiet: number; // how many projects had nothing at all
}

function unreadable(
  root: string,
  window: DebriefWindow,
  reason: string,
): CodeLedger {
  const failed = { ok: false as const, reason };
  return {
    root,
    sinceMs: window.sinceMs,
    untilMs: window.untilMs,
    capped: window.capped,
    tree: failed,
    commits: failed,
    prs: failed,
    runs: failed,
    issues: failed,
    releases: failed,
  };
}

export async function runStandup(
  deps: StandupDeps,
  roots: readonly string[],
  window: DebriefWindow,
): Promise<StandupResult> {
  const ledgers: CodeLedger[] = [];
  const jobs: ReporterJob[] = [];
  let quiet = 0;

  for (const root of roots) {
    let ledger: CodeLedger;
    try {
      ledger = await deps.ledger(root, window);
    } catch (e) {
      // A project never vanishes because a probe threw. It appears with every
      // field stated as unreadable, which is a fact the debrief can print.
      ledger = unreadable(
        root,
        window,
        e instanceof Error ? e.message : String(e),
      );
    }

    let digests: SessionDigest[] = [];
    try {
      digests = await deps.digests(root, window);
    } catch {
      digests = []; // no memory -> ledger only, never a thrown standup
    }

    if (ledgerIsQuiet(ledger) && digests.length === 0) {
      quiet += 1;
      continue;
    }

    ledgers.push(ledger);
    if (digests.length > 0) jobs.push({ ledger, digests });
  }

  const reports =
    jobs.length > 0
      ? await deps.report(jobs, AbortSignal.timeout(STANDUP_DEADLINE_MS))
      : [];
  return { reports, ledgers, quiet };
}
