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
  const secrets = useApp((s) => s.secrets);
  const config = useApp((s) => s.config);
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
          <span className="statusbar-item">
            <i className="codicon codicon-git-branch" />
            {gitStatus.branch.head}
            {gitStatus.branch.upstream &&
              ` ${gitStatus.branch.ahead}↑ ${gitStatus.branch.behind}↓`}
          </span>
        )}
        {gitStatus && changes > 0 && (
          <span className="statusbar-item">{changes} changes</span>
        )}
      </div>
      <div className="statusbar-side">
        {anthropicStatus && (
          <button
            type="button"
            className="statusbar-item statusbar-status"
            title={`${anthropicStatus.description || "Anthropic status"} — opens status.anthropic.com`}
            onClick={() =>
              void window.airlock.hostOpenExternal(
                "https://status.anthropic.com",
              )
            }
          >
            <span className={dotClass(anthropicStatus.indicator)} />
            Claude: {anthropicStatus.indicator}
          </button>
        )}
        {secrets.length > 0 && (
          <span className="statusbar-item">
            <i className="codicon codicon-key" />
            {secrets.length}
          </span>
        )}
        {config && (
          <span
            className="statusbar-item"
            title="Whether new terminal sessions start with this project's secrets as environment variables"
          >
            terminal secrets {config.injectSecretsIntoTerminal ? "on" : "off"}
          </span>
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
