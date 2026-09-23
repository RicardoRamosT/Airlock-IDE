import type { AnthropicStatus, UpdateProgress } from "../../../shared/ipc";
import { ticketLine } from "../lib/updateTicket";
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

// The button's accessible name, or undefined to let its own text be the name.
//
// Idle, "Update" alone does not say from what to what, so the versions are
// added. On error the label says only "Update failed", so the reason is added.
// Every other phase already reads as exactly what is happening.
function updateAriaLabel(
  update: { currentVersion: string; latestVersion: string | null },
  progress: UpdateProgress,
): string | undefined {
  if (progress.phase === "error") return `Update failed: ${progress.message}`;
  if (progress.phase !== "idle") return undefined;
  return `Update ${update.currentVersion} \u2192 ${update.latestVersion}`;
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
      <div className="statusbar-side statusbar-side-left">
        {gitStatus && (
          <span
            className="statusbar-chip"
            title={
              gitStatus.branch.upstream
                ? `On ${gitStatus.branch.head}: ${gitStatus.branch.ahead} ahead, ${gitStatus.branch.behind} behind ${gitStatus.branch.upstream}`
                : `On ${gitStatus.branch.head}, no upstream`
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
      <div className="statusbar-side statusbar-side-right">
        {anthropicStatus && (
          <button
            type="button"
            className={`statusbar-chip statusbar-status tone-${statusTone(anthropicStatus.indicator)}`}
            title={`${anthropicStatus.description || "Anthropic status"}, opens status.claude.com`}
            onClick={() =>
              void window.airlock.hostOpenExternal("https://status.claude.com")
            }
          >
            <span className={dotClass(anthropicStatus.indicator)} />
            {/* Name the component that decided this. "Claude Degraded" left
                the user to guess which of six products was unwell, and the
                answer was usually one they do not use. */}
            <span className="statusbar-status-label">
              {anthropicStatus.indicator === "operational"
                ? "Claude"
                : (anthropicStatus.component ?? "Claude")}
            </span>
            <span className="statusbar-status-value">
              {anthropicStatus.indicator}
            </span>
          </button>
        )}
      </div>
      {/* Centered and OUT of both sides' flow (absolutely positioned): the button
          appears and disappears without shifting the Claude chip or the branch. */}
      {update?.available && (
        <div className="statusbar-update-ticket">
          <button
            type="button"
            className="statusbar-update"
            disabled={busy}
            // aria-label, NOT title. `title` draws the OS tooltip, which
            // repeated the two versions a second time, in a second style,
            // below a callout that had just said it better -- and after the
            // OS's own hover delay, so it arrived as an afterthought. The
            // accessible name still has to exist, so it moves here: announced,
            // never drawn.
            //
            // ONLY WHERE THE TEXT IS NOT ALREADY THE ANSWER. aria-label
            // REPLACES the button's text as its accessible name, where `title`
            // merely filled in when there was none -- so labelling every phase
            // would have announced "Update 0.1.1 -> 0.2.0" while the button
            // visibly read "42%", replacing live progress with a stale
            // constant. Mid-apply the label IS the state, so it is left to
            // speak for itself.
            aria-label={updateAriaLabel(update, updateProgress)}
            onClick={() => void window.airlock.updateApply()}
          >
            <i className="codicon codicon-arrow-up" />
            {updateLabel(updateProgress)}
          </button>
          {/* aria-hidden because the button's own aria-label already says it --
              this is announced anyway even while invisible, and hearing the two
              versions twice is worse than not styling it at all.

              ON ERROR IT CARRIES THE MESSAGE. That text used to live only in
              the button's `title`, so deleting the tooltip would have taken the
              one place a sighted user could read WHY an update failed -- the
              label says no more than "Update failed". The callout is the
              surface this pattern already has for saying more on hover. */}
          <div className="statusbar-update-callout" aria-hidden="true">
            {updateProgress.phase === "error" ? (
              <span className="statusbar-ticket-line next">
                {updateProgress.message}
              </span>
            ) : (
              <>
                <span className="statusbar-ticket-line">
                  {ticketLine(update.currentVersion, update.currentBuiltAt)}
                </span>
                <i className="codicon codicon-arrow-down statusbar-ticket-arrow" />
                <span className="statusbar-ticket-line next">
                  {ticketLine(update.latestVersion, update.latestBuiltAt)}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
