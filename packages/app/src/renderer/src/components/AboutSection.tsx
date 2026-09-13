import { useEffect, useState } from "react";
import type {
  AppInfo,
  LicenseDocKind,
  UpdateProgress,
  UpdateStatus,
} from "../../../shared/ipc";

import { Loading } from "./Loading";
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

  const openDoc = (kind: LicenseDocKind) => () => {
    void window.airlock.openLicenseDoc(kind).catch(() => {});
  };

  return (
    <section className="settings-section">
      <h3>About</h3>
      <div className="settings-row">
        <span>Version</span>
        <span className="settings-value">{info?.version ?? "unknown"}</span>
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
        <Loading label="Checking for updates" />
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

      {/* The licence has to be readable from inside the app, not only from the
          repo: PolyForm Strict makes agreeing to the terms a condition of the
          grant, and the commercial licence is something a user at a company has
          to be able to discover. Both documents ship in the bundle. */}
      <div className="settings-sublabel">Licence</div>
      <div className="settings-row">
        <span>Default grant</span>
        <span className="settings-value">PolyForm Strict 1.0.0</span>
      </div>
      <p className="settings-note">
        Free for any noncommercial purpose: personal study, hobby projects,
        research, and use by charities, schools, public research bodies and
        government. Commercial use, including a developer at a company running
        AirLock on that company's code, needs a separate licence. Modification
        and redistribution are not permitted under either grant.
      </p>
      <div className="settings-row">
        <button
          type="button"
          className="settings-btn"
          onClick={openDoc("license")}
        >
          Read the licence
        </button>
        <button
          type="button"
          className="settings-btn settings-btn--ghost"
          onClick={openDoc("commercial")}
        >
          Commercial use
        </button>
      </div>

      <div className="settings-sublabel">Third-party notices</div>
      <p className="settings-note">
        AirLock bundles Electron and Chromium, whose notices ship with the app,
        and its npm dependencies under their own permissive licences (MIT, ISC,
        BSD and Apache-2.0), each package carrying its own licence file. Icons
        are <span className="settings-value">@vscode/codicons</span>, used under
        CC BY 4.0.
      </p>
      <div className="settings-row">
        <button
          type="button"
          className="settings-btn settings-btn--ghost"
          onClick={openDoc("electron")}
        >
          Electron
        </button>
        <button
          type="button"
          className="settings-btn settings-btn--ghost"
          onClick={openDoc("chromium")}
        >
          Chromium
        </button>
      </div>
    </section>
  );
}
