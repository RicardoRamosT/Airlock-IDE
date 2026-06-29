import { useCallback, useEffect, useRef, useState } from "react";
import type { DevServerStartResult, DevServerState } from "../../../shared/ipc";
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
//
// Managed dev-server state (dev/setDev): seeded from devServerStatus(root) and
// kept live via onDevServerChanged. When dev.status !== "idle" the managed server
// takes priority over the explicit-devUrl probe path.
export function LocalHostSection() {
  // The dev-server URL is per-root (config.devUrl, else a guess from the root's
  // server). The host IPC still resolves the window root for T2 (single pane =>
  // window root === the pane's root); scoping to the pane's root here keys the
  // probe so a future second pane re-probes when ITS project changes.
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const hostRefreshNonce = useApp((s) => s.hostRefreshNonce);
  const switchTab = useApp((s) => s.switchTab);
  const setActiveTerminal = useApp((s) => s.setActiveTerminal);

  // Explicit-devUrl probe state (the manual override path).
  const [url, setUrl] = useState<string | null>(null);
  const [up, setUp] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Managed dev-server state.
  const [dev, setDev] = useState<DevServerState | null>(null);
  // Command confirm/input state (prefilled with the guessed command on first Start).
  const [cmdEditing, setCmdEditing] = useState(false);
  const [cmdDraft, setCmdDraft] = useState("");

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
    }
  }, [root]);

  // Probe on mount and whenever the pane's project (root) changes -- `refresh`
  // changes with `root`, so this effect re-runs. Live updates are delegated to
  // startFocusPolling: re-probe every HOST_POLL_MS while focused (the dev server
  // may be started/stopped outside the app, e.g. Ctrl-C'd in a terminal pane,
  // which never blurs the window) and pause when backgrounded. See focusPolling.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hostRefreshNonce is not read in the body but intentionally included as a trigger dep — the single HOST-header Refresh bumps it to re-probe the dev server.
  useEffect(() => {
    void refresh();
    return startFocusPolling(() => void refresh(), HOST_POLL_MS, {
      hasFocus: () => document.hasFocus(),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      addEventListener: (type, fn) => window.addEventListener(type, fn),
      removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    });
  }, [refresh, hostRefreshNonce]);

  // Seed managed state and subscribe to live changes.
  useEffect(() => {
    if (!root) return;
    let alive = true;
    window.airlock.devServerStatus(root).then((s) => {
      if (alive) setDev(s ?? null);
    });
    const off = window.airlock.onDevServerChanged((e) => {
      if (e.root === root) setDev(e.state);
    });
    return () => {
      alive = false;
      off();
    };
  }, [root]);

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

  // Managed dev-server handlers.
  const onStart = async () => {
    if (!root) return;
    const r: DevServerStartResult = await window.airlock.devServerStart(root);
    if (r.ok) return; // state arrives via onDevServerChanged
    setCmdDraft(r.guess ?? "");
    setCmdEditing(true);
  };

  const onConfirmCommand = async () => {
    if (!root) return;
    await window.airlock.devServerSetCommand(root, cmdDraft.trim());
    setCmdEditing(false);
  };

  const onStop = () => {
    if (root) void window.airlock.devServerStop(root);
  };

  const onRestart = async () => {
    if (!root) return;
    await window.airlock.devServerStop(root);
    await window.airlock.devServerStart(root);
  };

  const dotClass =
    up === true
      ? "status-dot on"
      : up === false
        ? "status-dot fail"
        : "status-dot";

  // Command confirm/input (shown when a Start returns needsCommand).
  if (cmdEditing) {
    return (
      <div className="docker">
        <div className="docker-row">
          <input
            className="sb-control"
            value={cmdDraft}
            onChange={(e) => setCmdDraft(e.target.value)}
            placeholder="npm run dev"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void onConfirmCommand()}
            disabled={cmdDraft.trim() === ""}
            title="Confirm dev command"
          >
            Save
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setCmdEditing(false)}
            title="Cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Managed server states (priority over explicit-devUrl when not idle).
  const devStatus = dev?.status ?? "idle";

  if (devStatus === "starting") {
    return (
      <div className="docker">
        <div className="docker-row">
          <span className="status-dot" />
          <span className="docker-name">&#x25D0; starting&hellip;</span>
          <button
            type="button"
            className="row-action"
            onClick={onStop}
            title="Stop dev server"
          >
            <i className="codicon codicon-debug-stop" />
          </button>
        </div>
      </div>
    );
  }

  if (devStatus === "running" && dev) {
    const startedByLabel = dev.startedBy === "agent" ? "Claude" : "you";
    return (
      <div className="docker">
        <div className="docker-row" title={dev.url ?? undefined}>
          <span className="status-dot on" />
          <span className="docker-name host-url">
            {dev.url ?? "port unknown"}
          </span>
          {dev.url && (
            <button
              type="button"
              className="row-action"
              onClick={() =>
                dev.url && void window.airlock.hostOpenExternal(dev.url)
              }
              title="Open in browser"
            >
              <i className="codicon codicon-link-external" />
            </button>
          )}
          <button
            type="button"
            className="row-action"
            onClick={onStop}
            title="Stop dev server"
          >
            <i className="codicon codicon-debug-stop" />
          </button>
          <button
            type="button"
            className="row-action"
            onClick={() => void onRestart()}
            title="Restart dev server"
          >
            <i className="codicon codicon-debug-restart" />
          </button>
        </div>
        <div className="section-note">
          <button
            type="button"
            className="section-note"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: dev.terminalId ? "pointer" : "default",
              textAlign: "left",
            }}
            onClick={() => {
              if (dev.terminalId) {
                // Find the tab that owns this terminal and switch to it.
                const state = useApp.getState();
                for (const [tid, tt] of Object.entries(state.tabTerminals)) {
                  const term = tt.terminals.find(
                    (t) => t.id === dev.terminalId,
                  );
                  if (term) {
                    switchTab(tid);
                    setActiveTerminal(dev.terminalId, tid);
                    break;
                  }
                }
              }
            }}
            title={dev.terminalId ? "Focus dev terminal" : undefined}
          >
            started by {startedByLabel} · dev terminal
          </button>
        </div>
      </div>
    );
  }

  if (devStatus === "exited" && dev) {
    const exitSuffix = dev.exitCode != null ? ` (code ${dev.exitCode})` : "";
    return (
      <div className="docker">
        <div className="docker-row">
          <span className="status-dot fail" />
          <span className="docker-name">
            &#x2715; dev server exited{exitSuffix}
          </span>
        </div>
        <div className="section-toolbar">
          <button
            type="button"
            className="btn"
            onClick={() => void onStart()}
            title="Start dev server"
          >
            Start
          </button>
        </div>
      </div>
    );
  }

  // idle state (or no managed server): show explicit-devUrl probe path + Start.
  return (
    <div className="docker">
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
        <>
          <div className="section-note">No dev server detected</div>
          <div className="section-toolbar">
            {root && (
              <button
                type="button"
                className="btn"
                onClick={() => void onStart()}
                title="Start dev server"
              >
                Start
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDraft("http://localhost:3000");
                setEditing(true);
              }}
              title="Set dev server URL"
            >
              Set URL
            </button>
          </div>
        </>
      )}
    </div>
  );
}
