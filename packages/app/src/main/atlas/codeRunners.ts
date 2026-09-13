// ASCII comments only. The impure half of the ledger: git subprocesses and four
// gh calls per project, each folded into a Probe.
//
// READ-ONLY, same rule as runners.ts: nothing here runs `gh auth switch`,
// writes git config, or touches any global single-valued resource.
//
// Every probe is independently fallible and independently reported. One broken
// gh call must not cost the project its commits, and an empty result must never
// be confused with a failed one.
import {
  CEILING_COMMITS,
  CEILING_GH,
  type CodeLedger,
  type CollectDeps,
  capItems,
  type DebriefWindow,
  type Probe,
  parseIssueList,
  parsePrList,
  parseReleaseList,
  parseRunList,
} from "@airlock/agent-core";
import type { PinnedGh } from "../github/ghRunner";

export interface LedgerDeps {
  git: CollectDeps;
  gh(root: string): Promise<PinnedGh>;
}

function failed(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.trim().slice(0, 300) || "unknown error";
}

// One gh probe. `degraded` is treated as a FAILURE even though gh answered:
// an answer from the wrong account is not this project's answer.
async function ghProbe<T>(
  gh: PinnedGh,
  args: string[],
  root: string,
  parse: (raw: string) => T[],
): Promise<Probe<T[]>> {
  if (gh.degraded) return { ok: false, reason: gh.degraded };
  try {
    const capped = capItems(parse(await gh.run(args, root)), CEILING_GH);
    return { ok: true, value: capped.items, withheld: capped.withheld };
  } catch (e) {
    return { ok: false, reason: failed(e) };
  }
}

export async function collectLedger(
  deps: LedgerDeps,
  root: string,
  window: DebriefWindow,
): Promise<CodeLedger> {
  const { sinceMs, untilMs, capped } = window;
  const base: CodeLedger = {
    root,
    sinceMs,
    untilMs,
    capped,
    tree: { ok: false, reason: "not a git repository" },
    commits: { ok: false, reason: "not a git repository" },
    prs: { ok: false, reason: "not a git repository" },
    runs: { ok: false, reason: "not a git repository" },
    issues: { ok: false, reason: "not a git repository" },
    releases: { ok: false, reason: "not a git repository" },
  };

  if (!(await deps.git.exists(root)))
    return { ...base, tree: { ok: false, reason: "folder is missing" } };
  if (!(await deps.git.isRepo(root))) return base;

  const ledger: CodeLedger = { ...base };

  try {
    const st = await deps.git.status(root);
    ledger.tree = {
      ok: true,
      value: {
        branch: st.branch.head,
        upstream: st.branch.upstream,
        ahead: st.branch.ahead,
        behind: st.branch.behind,
        dirty: st.staged.length + st.unstaged.length + st.untracked.length,
      },
    };
  } catch (e) {
    ledger.tree = { ok: false, reason: failed(e) };
  }

  try {
    const all = await deps.git.log(root, sinceMs);
    const cap = capItems(all, CEILING_COMMITS);
    ledger.commits = { ok: true, value: cap.items, withheld: cap.withheld };
  } catch (e) {
    ledger.commits = { ok: false, reason: failed(e) };
  }

  // gh's --search date filter has day granularity, so ask for one day earlier
  // than the window and let the parsers filter precisely on the timestamp.
  const day = new Date(sinceMs - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let gh: PinnedGh;
  try {
    gh = await deps.gh(root);
  } catch (e) {
    const reason = failed(e);
    return {
      ...ledger,
      prs: { ok: false, reason },
      runs: { ok: false, reason },
      issues: { ok: false, reason },
      releases: { ok: false, reason },
    };
  }

  const limit = String(CEILING_GH);
  const [prs, runs, issues, releases] = await Promise.all([
    ghProbe(
      gh,
      [
        "pr",
        "list",
        "--state",
        "all",
        "--limit",
        limit,
        "--search",
        `updated:>=${day}`,
        "--json",
        "number,title,state,updatedAt,url",
      ],
      root,
      (raw) => parsePrList(raw, sinceMs),
    ),
    ghProbe(
      gh,
      [
        "run",
        "list",
        "--limit",
        limit,
        "--created",
        `>=${day}`,
        "--json",
        "workflowName,status,conclusion,headBranch,url,createdAt",
      ],
      root,
      (raw) => parseRunList(raw, sinceMs),
    ),
    ghProbe(
      gh,
      [
        "issue",
        "list",
        "--state",
        "all",
        "--limit",
        limit,
        "--search",
        `updated:>=${day}`,
        "--json",
        "number,title,state,updatedAt,url",
      ],
      root,
      (raw) => parseIssueList(raw, sinceMs),
    ),
    // NO url field: `gh release list --json` does not offer one (verified
    // against gh 2026-09-12 -- it accepts only createdAt, isDraft, isImmutable,
    // isLatest, isPrerelease, name, publishedAt, tagName). Asking for it fails
    // the whole call with "Unknown JSON field", which is how this shipped
    // broken on every repo until a real run surfaced it.
    ghProbe(
      gh,
      [
        "release",
        "list",
        "--limit",
        limit,
        "--json",
        "tagName,name,publishedAt",
      ],
      root,
      (raw) => parseReleaseList(raw, sinceMs),
    ),
  ]);

  return { ...ledger, prs, runs, issues, releases };
}
