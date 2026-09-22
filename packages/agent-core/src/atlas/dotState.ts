// One project's dot on the Atlas spine.
//
// PURE, and deliberately strict about green: a dot is the only thing the spine
// says at rest, so a colour that means merely "nothing went wrong" is a colour
// that lies. Green requires positive evidence on EVERY input; anything unread
// -- a gh call that failed, a repo with no remote, a probe that has not
// returned yet -- is quiet.

export type DotTone = "fail" | "you" | "clean" | "quiet";

export interface SpinePr {
  mine: boolean;
  awaitingReview: boolean;
  draft: boolean;
}

// null on a field means NOT READ: not "absent", not "fine".
export interface SpineInput {
  tree: { dirty: number; branch: string | null; hasRemote: boolean } | null;
  ci: { status: string; conclusion: string | null } | null;
  prs: SpinePr[] | null;
}

// Conclusions that mean the build is broken. `cancelled` is deliberately NOT
// here: someone stopping a run is not the project being broken.
const BROKEN = new Set(["failure", "timed_out", "startup_failure"]);

export function dotState(input: SpineInput): DotTone {
  // Red outranks everything, and is worth reporting even if the other probes
  // lagged: a broken build is true regardless of the tree's state.
  if (input.ci?.conclusion && BROKEN.has(input.ci.conclusion)) return "fail";

  // Amber: the next move is YOURS. Not "any open PR" -- a teammate's PR and
  // your own draft are not your move, and counting them would make amber
  // common enough to stop meaning "act now".
  if (input.prs?.some((p) => p.mine && p.awaitingReview && !p.draft))
    return "you";

  if (
    input.tree !== null &&
    input.ci !== null &&
    input.prs !== null &&
    input.tree.dirty === 0 &&
    input.ci.conclusion === "success"
  )
    return "clean";

  return "quiet";
}
