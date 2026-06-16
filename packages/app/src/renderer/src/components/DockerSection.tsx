import { useCallback, useEffect, useState } from "react";
import type { Container } from "../../../shared/ipc";

interface DockerState {
  installed: boolean;
  running: boolean;
  containers: Container[];
}

const INITIAL: DockerState = { installed: true, running: true, containers: [] };

export function DockerSection() {
  const [state, setState] = useState<DockerState>(INITIAL);
  // Per-container id currently mid start/stop, so only that row's action is
  // disabled (other rows stay actionable while one container toggles).
  const [acting, setActing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const s = await window.airlock.dockerList();
      setState(s);
    } catch (err) {
      console.error("dockerList failed", err);
    } finally {
      setBusy(false);
    }
  }, []);

  // Fetch on mount and re-fetch whenever the window regains focus (a container
  // may have been started/stopped outside the app). The focus listener is added
  // and removed together so it never outlives the (collapsible) section.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const toggle = async (c: Container) => {
    const running = c.state === "running";
    setActing(c.id);
    try {
      if (running) {
        await window.airlock.dockerStop(c.id);
      } else {
        await window.airlock.dockerStart(c.id);
      }
      await refresh();
    } catch (err) {
      console.error(
        running ? "dockerStop failed" : "dockerStart failed",
        c.id,
        err,
      );
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="docker">
      <div className="section-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => void refresh()}
          disabled={busy}
          title="Refresh container list"
        >
          ↻ Refresh
        </button>
      </div>
      {!state.installed ? (
        <div className="section-note">Docker not found</div>
      ) : !state.running ? (
        <div className="section-note">Docker daemon not running</div>
      ) : state.containers.length === 0 ? (
        <div className="section-note">No containers</div>
      ) : (
        state.containers.map((c) => {
          const running = c.state === "running";
          return (
            <div key={c.id} className="docker-row" title={c.status}>
              <span className={running ? "status-dot on" : "status-dot"} />
              <span className="docker-name">{c.name}</span>
              <span className="docker-image">{c.image}</span>
              <button
                type="button"
                className="row-action"
                onClick={() => void toggle(c)}
                disabled={acting === c.id}
                title={running ? "Stop container" : "Start container"}
              >
                <i
                  className={`codicon codicon-${running ? "debug-stop" : "debug-start"}`}
                />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
