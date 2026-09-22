// Open pull requests for one project, reduced to the question the spine asks:
// is the next move MINE.
//
// ASCII-only comments and string literals (CJS-bundled into Electron main).
//
// Deliberately NOT Atlas's PrEvent: that carries number/title/state/updatedAt/
// url and nothing else, so a dot built on it goes amber for any open PR at
// all, including a teammate's and your own draft. Asking gh for author,
// reviewDecision and isDraft is the difference between amber meaning "act now"
// and amber meaning "a PR exists somewhere".

import type { SpinePr } from "@airlock/agent-core";
import { ghRunnerFor } from "./ghRunner";

// REVIEW_REQUIRED and an absent decision both mean nobody has decided yet.
// APPROVED and CHANGES_REQUESTED are decisions, so the ball has moved.
const UNDECIDED = new Set(["REVIEW_REQUIRED", ""]);

// Your gh login, cached by ACCOUNT rather than by root.
//
// It cannot be one global value: ghRunnerFor honours the per-project pin, so
// two projects pinned to different accounts genuinely have different answers.
// But most projects share an account, so keying on the account collapses one
// identity call per project per cycle into one per account.
const loginCache = new Map<string, string>();

// Test seam.
export function __resetOpenPrs(): void {
  loginCache.clear();
}

/**
 * Parse `gh pr list --json ...` output.
 *
 * Junk yields [], never a throw: this runs on a timer, and a malformed
 * response must leave the dot alone rather than take the poll down.
 */
export function parseOpenPrs(raw: string, me: string): SpinePr[] {
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const out: SpinePr[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const author = r.author as { login?: unknown } | undefined;
    const login = typeof author?.login === "string" ? author.login : "";
    const decision =
      typeof r.reviewDecision === "string" ? r.reviewDecision : "";
    out.push({
      // An unknown viewer must never match an unknown author: without the
      // non-empty check, every anonymous row would read as yours.
      mine: me !== "" && login === me,
      awaitingReview: UNDECIDED.has(decision),
      draft: r.isDraft === true,
    });
  }
  return out;
}

/**
 * Open PRs for a project, or null when the question could not be asked.
 *
 * NULL IS NOT []. An empty array means "asked, none open"; null means the call
 * failed, there is no repo, or gh is absent -- and dotState turns null into a
 * quiet dot rather than a green one.
 *
 * Runs through ghRunnerFor so the PINNED account asks. gh has one globally
 * active account, so a pinned repo asked by the active one 404s, and that 404
 * would arrive here as "no PRs" -- indistinguishable from a clean project.
 */
export async function openPrsFor(root: string): Promise<SpinePr[] | null> {
  try {
    const gh = await ghRunnerFor(root);
    const key = gh.account ?? "";
    let me = loginCache.get(key);
    if (me === undefined) {
      me = (await gh.run(["api", "user", "--jq", ".login"], root)).trim();
      if (!me) return null;
      loginCache.set(key, me);
    }
    const raw = await gh.run(
      [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "30",
        "--json",
        "number,isDraft,reviewDecision,author",
      ],
      root,
    );
    return parseOpenPrs(raw, me);
  } catch {
    return null;
  }
}
