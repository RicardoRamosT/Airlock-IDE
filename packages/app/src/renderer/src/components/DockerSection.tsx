import { useCallback, useEffect, useState } from "react";
import type { Container, DbContainer } from "../../../shared/ipc";
import { openSidebarSection } from "../lib/extensionActions";

interface DockerState {
  installed: boolean;
  running: boolean;
  containers: Container[];
}

const INITIAL: DockerState = { installed: true, running: true, containers: [] };

export function DockerSection() {
  const [state, setState] = useState<DockerState>(INITIAL);
  // The subset of containers Databases recognises as a database, keyed by id.
  // Fetched rather than derived: the image -> engine rule lives in agent-core
  // (databaseContainers), and the renderer must not value-import it.
  const [dbs, setDbs] = useState<Map<string, DbContainer>>(new Map());
  // Per-container id currently mid start/stop, so only that row's action is
  // disabled (other rows stay actionable while one container toggles).
  const [acting, setActing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [s, d] = await Promise.all([
        window.airlock.dockerList(),
        // A failure here costs the -> affordance, not the container list, so
        // it degrades to an empty map rather than failing the refresh.
        window.airlock.dockerDatabases().catch(() => [] as DbContainer[]),
      ]);
      setState(s);
      setDbs(new Map(d.map((x) => [x.id, x])));
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

  // Whether Databases can actually DO something with this container, which is
  // the only thing that earns a "->". All three conditions are load-bearing:
  // the client is pg so nothing but postgres is connectable; a null hostPort
  // means it is reachable only inside the docker network; and a stopped
  // container has no Connect button waiting at the other end. Sending someone
  // to a row that cannot act is the true-but-useless dead end this whole
  // pattern exists to avoid -- for a stopped container the honest next step is
  // the start button already sitting beside this one.
  const queryable = (c: Container): boolean => {
    const db = dbs.get(c.id);
    return (
      c.state === "running" && db?.engine === "postgres" && db.hostPort !== null
    );
  };

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
              {queryable(c) && (
                <button
                  type="button"
                  className="row-action"
                  onClick={() => openSidebarSection("databases")}
                  title={`Query ${c.name} in Databases`}
                  aria-label={`Query ${c.name} in Databases`}
                >
                  <i className="codicon codicon-arrow-right" />
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
