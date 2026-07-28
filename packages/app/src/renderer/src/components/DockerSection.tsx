import { useCallback, useEffect, useState } from "react";
import type { Container, DbContainer, DbTable } from "../../../shared/ipc";
import { useApp } from "../store";

import { Loading } from "./Loading";

interface DockerState {
  installed: boolean;
  running: boolean;
  containers: Container[];
}

const INITIAL: DockerState = { installed: true, running: true, containers: [] };

// Per-container Postgres state, fetched on first expand. `ready: false` means
// no usable credentials were found (see dockerPostgresUrl) -- distinct from
// "connected, no databases", which is `ready: true` with an empty list. The UI
// must say WHICH: otherwise a server we cannot reach and a server with nothing
// in it render identically.
interface PgState {
  ready: boolean;
  databases: string[];
  error: string | null;
}

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
  // Lazy tree, mirroring NeonSection: nothing is fetched until its parent
  // expands, and results are cached so re-expanding is free. Keys are the
  // container id, and `${containerId}/${database}` for tables.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pg, setPg] = useState<Record<string, PgState>>({});
  const [tables, setTables] = useState<Record<string, DbTable[]>>({});

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [s, d] = await Promise.all([
        window.airlock.dockerList(),
        // A failure here costs the database tree, not the container list, so
        // it degrades to an empty map rather than failing the refresh.
        window.airlock.dockerDatabases().catch(() => [] as DbContainer[]),
      ]);
      setState(s);
      setDbs(new Map(d.map((x) => [x.id, x])));
      // Drop cached query results: a container may have been recreated, and
      // stale tables under a new server would be a quiet lie. Expansion state
      // survives, so the tree reopens where the user left it.
      setPg({});
      setTables({});
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

  // Whether this container runs a Postgres server we could actually query: the
  // client is pg, a null hostPort means it is reachable only inside the docker
  // network, and a stopped container answers nothing.
  const queryable = (c: Container): boolean => {
    const db = dbs.get(c.id);
    return (
      c.state === "running" && db?.engine === "postgres" && db.hostPort !== null
    );
  };

  const toggleContainer = async (c: Container) => {
    const open = !expanded[c.id];
    setExpanded((e) => ({ ...e, [c.id]: open }));
    if (!open || pg[c.id]) return;
    try {
      const [ready, databases] = await Promise.all([
        window.airlock.dockerPgReady(c.id),
        window.airlock.dockerPgDatabases(c.id),
      ]);
      setPg((p) => ({ ...p, [c.id]: { ready, databases, error: null } }));
    } catch (err) {
      setPg((p) => ({
        ...p,
        [c.id]: {
          ready: true,
          databases: [],
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const toggleDatabase = async (containerId: string, database: string) => {
    const key = `${containerId}/${database}`;
    const open = !expanded[key];
    setExpanded((e) => ({ ...e, [key]: open }));
    if (!open || tables[key]) return;
    try {
      const t = await window.airlock.dockerPgTables(containerId, database);
      setTables((x) => ({ ...x, [key]: t }));
    } catch (err) {
      console.error("dockerPgTables failed", err);
      setTables((x) => ({ ...x, [key]: [] }));
    }
  };

  const openTable = (containerId: string, database: string, t: DbTable) => {
    useApp.getState().openDbTable({
      kind: "docker",
      containerId,
      database,
      schema: t.schema,
      table: t.name,
    });
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

  // The body under an expanded container: one row per database, each expanding
  // to its tables. Every terminal state names a REASON rather than rendering
  // blank -- the rule the Databases/Host rows already follow.
  const pgBody = (c: Container) => {
    const st = pg[c.id];
    if (!st) return <Loading label="Loading Docker databases" />;
    if (st.error) return <div className="section-note">{st.error}</div>;
    if (!st.ready)
      return (
        <div className="section-note">
          No credentials found in this container's environment.
        </div>
      );
    if (st.databases.length === 0)
      return <div className="section-note">No databases.</div>;
    return st.databases.map((d) => {
      const key = `${c.id}/${d}`;
      const open = !!expanded[key];
      const ts = tables[key];
      return (
        <div key={key}>
          <button
            type="button"
            className="db-row"
            onClick={() => void toggleDatabase(c.id, d)}
            aria-expanded={open}
          >
            <i
              className={`codicon codicon-chevron-${open ? "down" : "right"}`}
            />
            <span className="db-name">{d}</span>
          </button>
          {open &&
            (ts === undefined ? (
              <Loading label="Loading tables" />
            ) : ts.length === 0 ? (
              <div className="section-note">No tables.</div>
            ) : (
              ts.map((t) => (
                <button
                  key={`${t.schema}.${t.name}`}
                  type="button"
                  className="db-table-row"
                  onClick={() => openTable(c.id, d, t)}
                  title={`${t.schema}.${t.name}`}
                >
                  <i className="codicon codicon-table" />
                  <span className="db-table-name">
                    {t.schema === "public" ? t.name : `${t.schema}.${t.name}`}
                  </span>
                </button>
              ))
            ))}
        </div>
      );
    });
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
          const canQuery = queryable(c);
          const open = !!expanded[c.id];
          return (
            <div key={c.id}>
              <div className="docker-row" title={c.status}>
                {canQuery ? (
                  <button
                    type="button"
                    className="docker-expand"
                    onClick={() => void toggleContainer(c)}
                    aria-expanded={open}
                    aria-label={`${open ? "Collapse" : "Expand"} ${c.name} databases`}
                  >
                    <i
                      className={`codicon codicon-chevron-${open ? "down" : "right"}`}
                    />
                  </button>
                ) : (
                  // A fixed-width spacer, so names stay aligned whether or not
                  // a row can expand.
                  <span className="docker-expand-spacer" />
                )}
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
              {canQuery && open && (
                <div className="neon-children">{pgBody(c)}</div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
