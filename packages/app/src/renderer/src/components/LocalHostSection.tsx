import { useCallback, useEffect, useRef, useState } from "react";
import { startFocusPolling } from "../lib/focusPolling";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

// Re-probe cadence for the dev-server status while the window is focused. A
// probe is a sub-second localhost TCP connect, so 5s keeps the dot live (a
// server started/stopped outside the app flips within ~5s) at negligible cost.
const HOST_POLL_MS = 5000;

// The local dev-server group of the Host section. Builds on DockerSection's
// refresh-on-focus + busy guard (the server may be started/stopped outside the
// app) by ALSO polling on a timer while focused (see the effect below), and
// reuses NeonSection's mounted-ref guard (so an in-flight probe never sets
// state after the collapsible section unmounts).
//
// State machine:
//   url  : the resolved dev-server URL (config.devUrl, else guessed) or null.
//   up   : probe result -- true (reachable) / false (down) / null (unknown,
//          i.e. no url or mid-check). Drives the status dot.
//   editing/draft : the inline URL editor. Save persists via configSet({devUrl})
//          then re-refreshes; Cancel discards.
export function LocalHostSection() {
  // The dev-server URL is per-root (config.devUrl, else a guess from the root's
  // server). The host IPC still resolves the window root for T2 (single pane =>
  // window root === the pane's root); scoping to the pane's root here keys the
  // probe so a future second pane re-probes when ITS project changes.
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [up, setUp] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // Guards every async setState against an unmount-in-flight (like NeonSection).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!root) {
      setUrl(null);
      setUp(null);
      return;
    }
    setBusy(true);
    try {
      const u = await window.airlock.hostLocalUrl(root);
      if (!mounted.current) return;
      setUrl(u);
      if (u) {
        const { up: isUp } = await window.airlock.hostProbe(u);
        if (mounted.current) setUp(isUp);
      } else {
        setUp(null);
      }
    } catch (err) {
      console.error("host refresh failed", err);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [root]);

  // Probe on mount and whenever the pane's project (root) changes -- `refresh`
  // changes with `root`, so this effect re-runs. Live updates are delegated to
  // startFocusPolling: re-probe every HOST_POLL_MS while focused (the dev server
  // may be started/stopped outside the app, e.g. Ctrl-C'd in a terminal pane,
  // which never blurs the window) and pause when backgrounded. See focusPolling.
  useEffect(() => {
    void refresh();
    return startFocusPolling(() => void refresh(), HOST_POLL_MS, {
      hasFocus: () => document.hasFocus(),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      addEventListener: (type, fn) => window.addEventListener(type, fn),
      removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    });
  }, [refresh]);

  const save = async () => {
    const next = draft.trim();
    if (!next || !root) return;
    try {
      await window.airlock.configSet(root, { devUrl: next });
      if (mounted.current) setEditing(false);
      await refresh();
    } catch (err) {
      console.error("configSet devUrl failed", err);
    }
  };

  const dotClass =
    up === true
      ? "status-dot on"
      : up === false
        ? "status-dot fail"
        : "status-dot";

  return (
    <div className="docker">
      <div className="section-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => void refresh()}
          disabled={busy}
          title="Re-probe the dev server"
        >
          <i className="codicon codicon-refresh" /> Refresh
        </button>
      </div>
      {editing ? (
        <div className="docker-row">
          <input
            className="sb-control"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="http://localhost:5173"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void save()}
            disabled={draft.trim() === ""}
            title="Save dev server URL"
          >
            Save
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setEditing(false)}
            title="Cancel"
          >
            Cancel
          </button>
        </div>
      ) : url ? (
        <div className="docker-row" title={url}>
          <span className={dotClass} />
          <span className="docker-name host-url">{url}</span>
          <button
            type="button"
            className="row-action"
            onClick={() => void window.airlock.hostOpenExternal(url)}
            title="Open in browser"
          >
            <i className="codicon codicon-link-external" />
          </button>
          <button
            type="button"
            className="row-action"
            onClick={() => {
              setDraft(url);
              setEditing(true);
            }}
            title="Edit dev server URL"
          >
            <i className="codicon codicon-edit" />
          </button>
        </div>
      ) : (
        <div className="docker-row">
          <span className="section-note">No dev server detected</span>
          <button
            type="button"
            className="btn host-set"
            onClick={() => {
              setDraft("http://localhost:3000");
              setEditing(true);
            }}
            title="Set dev server URL"
          >
            Set URL
          </button>
        </div>
      )}
    </div>
  );
}
