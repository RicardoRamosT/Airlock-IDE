import { useCallback, useEffect, useRef, useState } from "react";

// The local dev-server group of the Host section. Mirrors DockerSection's
// refresh-on-focus + busy guard (the server may be started/stopped outside the
// app) and NeonSection's mounted-ref guard (so an in-flight probe never sets
// state after the collapsible section unmounts).
//
// State machine:
//   url  : the resolved dev-server URL (config.devUrl, else guessed) or null.
//   up   : probe result -- true (reachable) / false (down) / null (unknown,
//          i.e. no url or mid-check). Drives the status dot.
//   editing/draft : the inline URL editor. Save persists via configSet({devUrl})
//          then re-refreshes; Cancel discards.
export function LocalHostSection() {
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
    setBusy(true);
    try {
      const u = await window.airlock.hostLocalUrl();
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
  }, []);

  // Fetch on mount and re-fetch whenever the window regains focus (the dev
  // server may have been started/stopped outside the app). The focus listener
  // is added and removed together so it never outlives the section.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const save = async () => {
    const next = draft.trim();
    if (!next) return;
    try {
      await window.airlock.configSet({ devUrl: next });
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
      <div className="db-toolbar">
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
            className="host-input"
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
            className="docker-action"
            onClick={() => void window.airlock.hostOpenExternal(url)}
            title="Open in browser"
          >
            <i className="codicon codicon-link-external" />
          </button>
          <button
            type="button"
            className="docker-action"
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
