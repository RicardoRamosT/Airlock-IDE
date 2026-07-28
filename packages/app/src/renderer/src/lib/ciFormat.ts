import type { CiRun } from "../../../shared/ipc";

// How a CI run reads in the Git section.
//
// `ciRunState` is MOVED here verbatim from main/activity.ts rather than
// rewritten: it encodes which GitHub conclusions count as a failure, which is
// the kind of list that is easy to get subtly wrong twice. Deleting the Activity
// panel would otherwise have taken the only reviewed copy with it.
//
// CI lives in the Git section because it is BRANCH-scoped -- "did CI pass on
// this branch" belongs beside the branch, which is where you look anyway. It was
// the one thing in Activity with no other home; Render deploys and Docker states
// already have their own sections.

export type CiState = "running" | "done" | "failed" | "idle";

export function ciRunState(run: CiRun): CiState {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "done";
  if (
    run.conclusion === "failure" ||
    run.conclusion === "cancelled" ||
    run.conclusion === "timed_out" ||
    run.conclusion === "action_required" ||
    run.conclusion === "startup_failure" ||
    run.conclusion === "stale"
  ) {
    return "failed";
  }
  // Anything else completed (skipped, neutral, or a conclusion GitHub adds
  // later) is not a failure and not a success -- reporting it as either would
  // be a guess.
  return "idle";
}

// The shared status-dot class, so a CI run reads like every other state in the
// app rather than inventing its own colours.
export function ciDotClass(state: CiState): string {
  if (state === "done") return "status-dot on";
  if (state === "failed") return "status-dot fail";
  if (state === "running") return "status-dot running";
  return "status-dot";
}

// A short sentence for the row. Names the CONCLUSION when there is one, because
// "completed" alone does not tell you whether to go look at it.
export function ciStateLabel(run: CiRun): string {
  const state = ciRunState(run);
  if (state === "running") {
    return run.status === "queued" ? "queued" : "running";
  }
  if (state === "done") return "passed";
  if (state === "failed") return run.conclusion ?? "failed";
  return run.conclusion ?? "finished";
}

// Determinate progress ONLY where there is real discrete structure to count
// (jobs[].steps[]), never a fabricated number -- the membership rule the
// Activity panel was built on, and the one part of it worth keeping.
export function ciProgress(
  run: CiRun,
): { value: number; label: string } | null {
  if (run.stepsTotal <= 0) return null;
  return {
    value: Math.round((run.stepsDone / run.stepsTotal) * 100),
    label: `${run.stepsDone}/${run.stepsTotal} steps`,
  };
}
