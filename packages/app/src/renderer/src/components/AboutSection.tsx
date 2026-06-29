import { useEffect, useState } from "react";
import type {
  AppInfo,
  UpdateProgress,
  UpdateStatus,
} from "../../../shared/ipc";

// Settings → About. Version + MCP-server info (loopback port only — never the
// bearer token) and the update status, reusing the existing update IPC. Pure
// renderer: all data via window.airlock; no agent-core value import.
export function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ phase: "idle" });

  useEffect(() => {
    void window.airlock
      .appInfo()
      .then(setInfo)
      .catch(() => {});
    void window.airlock
      .updateGet()
      .then(setUpdate)
      .catch(() => {});
    const offChanged = window.airlock.onUpdateChanged(setUpdate);
    const offProgress = window.airlock.onUpdateProgress(setProgress);
    return () => {
      offChanged();
      offProgress();
    };
  }, []);

  const applying =
    progress.phase !== "idle" &&
    progress.phase !== "error" &&
    progress.phase !== "revealed";

  const openReleaseNotes = () => {
    if (update?.htmlUrl) window.open(update.htmlUrl, "_blank", "noopener");
  };

  return (
    <section className="settings-section">
      <h3>About</h3>
      <div className="settings-row">
        <span>Version</span>
        <span className="settings-value">{info?.version ?? "—"}</span>
      </div>
      <div className="settings-row">
        <span>MCP server</span>
        <span className="settings-value">
          {info?.mcpPort != null ? `127.0.0.1:${info.mcpPort}` : "not running"}
        </span>
      </div>
      <p className="settings-note">
        The local bridge the terminal agent talks to. Bound to loopback only and
        guarded by a bearer token (never shown); the port is informational.
      </p>

      <div className="settings-sublabel">Updates</div>
      {update === null ? (
        <div className="settings-note">Checking for updates…</div>
      ) : update.available ? (
        <>
          <div className="settings-row">
            <span>Update available</span>
            <span className="settings-value">v{update.latestVersion}</span>
          </div>
          <div className="settings-row">
            <button
              type="button"
              className="settings-btn"
              disabled={applying}
              onClick={() => void window.airlock.updateApply()}
            >
              {applying
                ? `Updating… (${progress.phase})`
                : "Download & install"}
            </button>
            {update.htmlUrl && (
              <button
                type="button"
                className="settings-btn settings-btn--ghost"
                onClick={openReleaseNotes}
              >
                Release notes
              </button>
            )}
          </div>
          {progress.phase === "error" && (
            <p className="settings-note">Update failed: {progress.message}</p>
          )}
        </>
      ) : (
        <div className="settings-note">
          You're on the latest version (v{update.currentVersion}).
        </div>
      )}
    </section>
  );
}
