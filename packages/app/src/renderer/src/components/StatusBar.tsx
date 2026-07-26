import type { AnthropicStatus, UpdateProgress } from "../../../shared/ipc";
import { useApp } from "../store";

// Dot tone per service indicator (reuses the status-dot color classes).
function dotClass(indicator: AnthropicStatus["indicator"]): string {
  if (indicator === "operational") return "status-dot on";
  if (indicator === "outage") return "status-dot fail";
  if (indicator === "degraded" || indicator === "maintenance")
    return "status-dot warn";
  return "status-dot"; // unknown
}

// Chip tone, which colors the state WORD (the dot alone is a 7px cue). Kept
// separate from dotClass so the two can't drift apart.
function statusTone(indicator: AnthropicStatus["indicator"]): string {
  if (indicator === "operational") return "ok";
  if (indicator === "outage") return "fail";
  if (indicator === "degraded" || indicator === "maintenance") return "warn";
  return "unknown";
}

// The Update button's label for the current apply phase.
function updateLabel(progress: UpdateProgress): string {
  switch (progress.phase) {
    case "downloading":
      return `↓ ${progress.percent}%`;
    case "mounting":
      return "Mounting…";
    case "swapping":
      return "Updating…";
    case "relaunching":
      return "Restarting…";
    case "revealed":
      return "Revealed in Finder";
    case "error":
      return "Update failed";
    default:
      return "Update";
  }
}

export function StatusBar() {
  const gitStatus = useApp((s) => s.gitStatus);
  const anthropicStatus = useApp((s) => s.anthropicStatus);
  const update = useApp((s) => s.update);
  const updateProgress = useApp((s) => s.updateProgress);
  const changes = gitStatus
    ? gitStatus.staged.length +
      gitStatus.unstaged.length +
      gitStatus.untracked.length
    : 0;
  // Busy while a step is mid-flight; idle/revealed/error leave it clickable.
  const busy =
    updateProgress.phase === "downloading" ||
    updateProgress.phase === "mounting" ||
    updateProgress.phase === "swapping" ||
    updateProgress.phase === "relaunching";

  return (
    <footer className="statusbar">
      <div className="statusbar-side">
        {gitStatus && (
          <span
            className="statusbar-chip"
            title={
              gitStatus.branch.upstream
                ? `On ${gitStatus.branch.head} — ${gitStatus.branch.ahead} ahead, ${gitStatus.branch.behind} behind ${gitStatus.branch.upstream}`
                : `On ${gitStatus.branch.head} — no upstream`
            }
          >
            <i className="codicon codicon-git-branch" />
            <span className="statusbar-branch">{gitStatus.branch.head}</span>
            {/* Ahead/behind show only when non-zero: "0↑ 0↓" on every in-sync
                branch was noise. The tooltip above always states both. */}
            {gitStatus.branch.ahead > 0 && (
              <span className="statusbar-sync">
                <i className="codicon codicon-arrow-up" />
                {gitStatus.branch.ahead}
              </span>
            )}
            {gitStatus.branch.behind > 0 && (
              <span className="statusbar-sync">
                <i className="codicon codicon-arrow-down" />
                {gitStatus.branch.behind}
              </span>
            )}
          </span>
        )}
        {gitStatus && changes > 0 && (
          <span
            className="statusbar-chip"
            title={`${changes} uncommitted change${changes === 1 ? "" : "s"}`}
          >
            <i className="codicon codicon-diff" />
            {changes} changed
          </span>
        )}
      </div>
      <div className="statusbar-side">
        {anthropicStatus && (
          <button
            type="button"
            className={`statusbar-chip statusbar-status tone-${statusTone(anthropicStatus.indicator)}`}
            title={`${anthropicStatus.description || "Anthropic status"} — opens status.claude.com`}
            onClick={() =>
              void window.airlock.hostOpenExternal("https://status.claude.com")
            }
          >
            <span className={dotClass(anthropicStatus.indicator)} />
            <span className="statusbar-status-label">Claude</span>
            <span className="statusbar-status-value">
              {anthropicStatus.indicator}
            </span>
          </button>
        )}
        {update?.available && (
          <button
            type="button"
            className="statusbar-update"
            disabled={busy}
            title={
              updateProgress.phase === "error"
                ? updateProgress.message
                : `Update ${update.currentVersion} → ${update.latestVersion}`
            }
            onClick={() => void window.airlock.updateApply()}
          >
            <i className="codicon codicon-arrow-up" />
            {updateLabel(updateProgress)}
          </button>
        )}
      </div>
    </footer>
  );
}
