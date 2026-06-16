import { useEffect, useRef, useState } from "react";
import type {
  DbTable,
  NeonBranch,
  NeonDatabase,
  NeonProject,
} from "../../../shared/ipc";
import { useApp } from "../store";

type PingState = "checking" | "ok" | "fail";

// A lazy Neon tree mirroring DatabasesSection's fetch-on-expand + status-dot
// patterns. Four levels, each fetched only when its parent expands and cached
// in a keyed Record so re-expanding is free:
//   projects                          neonProjects()
//   -> branches    key: projectId     neonBranches(projectId)
//   -> databases   key: p/b           neonDatabases(projectId, branchId)
//   -> tables      key: p/b/db        neonTables(projectId, branchId, db, role)
// Each database also self-pings on first appearance for its status dot. The
// database's `role` is its ownerName. Clicking a table sets dbView{kind:"neon"};
// the existing DataGrid (Task 5) fetches rows reactively from that.
export function NeonSection() {
  const modal = useApp((s) => s.modal);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<NeonProject[]>([]);
  const [branches, setBranches] = useState<Record<string, NeonBranch[]>>({});
  const [databases, setDatabases] = useState<Record<string, NeonDatabase[]>>(
    {},
  );
  const [tables, setTables] = useState<Record<string, DbTable[]>>({});
  const [pings, setPings] = useState<Record<string, PingState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Guards every async setState against a unmount-in-flight (like DataGrid).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Status on mount, and again whenever the modal closes (modal === null) so
  // the tree appears the moment the user finishes the Connect Neon modal.
  useEffect(() => {
    if (modal !== null) return;
    window.airlock
      .neonStatus()
      .then((s) => {
        if (mounted.current) setConnected(s.connected);
      })
      .catch((e: unknown) => {
        if (mounted.current) {
          console.error("neonStatus failed", e);
          setConnected(false);
        }
      });
  }, [modal]);

  // Once connected, load the project list.
  useEffect(() => {
    if (connected !== true) return;
    window.airlock
      .neonProjects()
      .then((p) => {
        if (mounted.current) setProjects(p);
      })
      .catch((e: unknown) => {
        if (mounted.current) {
          console.error("neonProjects failed", e);
          setError(e instanceof Error ? e.message : String(e));
        }
      });
  }, [connected]);

  // Ping a database the first time it appears in the tree. Runs independently
  // so one slow/unreachable DB never blocks the others from going green.
  const ping = (
    projectId: string,
    branchId: string,
    db: NeonDatabase,
    key: string,
  ) => {
    setPings((p) => ({ ...p, [key]: "checking" }));
    window.airlock
      .neonPing(projectId, branchId, db.name, db.ownerName)
      .then((r) => {
        if (mounted.current)
          setPings((p) => ({ ...p, [key]: r.ok ? "ok" : "fail" }));
      })
      .catch((e: unknown) => {
        console.error("neonPing failed", key, e);
        if (mounted.current) setPings((p) => ({ ...p, [key]: "fail" }));
      });
  };

  const toggle = (key: string) => {
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  };

  const expandProject = (projectId: string) => {
    const wasOpen = !!expanded[projectId];
    toggle(projectId);
    if (wasOpen || branches[projectId]) return;
    window.airlock
      .neonBranches(projectId)
      .then((b) => {
        if (mounted.current) setBranches((m) => ({ ...m, [projectId]: b }));
      })
      .catch((e: unknown) => {
        console.error("neonBranches failed", projectId, e);
        if (mounted.current)
          setError(e instanceof Error ? e.message : String(e));
      });
  };

  const expandBranch = (projectId: string, branchId: string) => {
    const key = `${projectId}/${branchId}`;
    const wasOpen = !!expanded[key];
    toggle(key);
    if (wasOpen || databases[key]) return;
    window.airlock
      .neonDatabases(projectId, branchId)
      .then((d) => {
        if (!mounted.current) return;
        setDatabases((m) => ({ ...m, [key]: d }));
        // Kick off a status ping for each database as it first appears.
        for (const db of d) ping(projectId, branchId, db, `${key}/${db.name}`);
      })
      .catch((e: unknown) => {
        console.error("neonDatabases failed", key, e);
        if (mounted.current)
          setError(e instanceof Error ? e.message : String(e));
      });
  };

  const expandDatabase = (
    projectId: string,
    branchId: string,
    db: NeonDatabase,
  ) => {
    const key = `${projectId}/${branchId}/${db.name}`;
    const wasOpen = !!expanded[key];
    toggle(key);
    if (wasOpen || tables[key]) return;
    window.airlock
      .neonTables(projectId, branchId, db.name, db.ownerName)
      .then((t) => {
        if (mounted.current) setTables((m) => ({ ...m, [key]: t }));
      })
      .catch((e: unknown) => {
        console.error("neonTables failed", key, e);
        if (mounted.current)
          setError(e instanceof Error ? e.message : String(e));
      });
  };

  const openTable = (
    projectId: string,
    branchId: string,
    db: NeonDatabase,
    t: DbTable,
  ) => {
    useApp.getState().openDbTable({
      kind: "neon",
      projectId,
      branchId,
      database: db.name,
      role: db.ownerName,
      schema: t.schema,
      table: t.name,
    });
  };

  // Clear the stored Neon API key. Recovers from a bad/stale key (e.g. a
  // connection string pasted into the API-key modal, which 401s forever).
  const disconnect = async () => {
    try {
      await window.airlock.neonDisconnect();
    } catch (e) {
      console.error("neonDisconnect failed", e);
    }
    if (mounted.current) {
      setConnected(false);
      setProjects([]);
      setError(null);
    }
  };

  if (connected === null) return <div className="section-note">checking…</div>;

  if (connected === false) {
    return (
      <div className="databases">
        <button
          type="button"
          className="btn"
          onClick={() => useApp.getState().setModal("connect-neon")}
        >
          Connect Neon
        </button>
      </div>
    );
  }

  return (
    <div className="databases">
      <div className="section-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => void disconnect()}
          title="Disconnect Neon and clear the stored API key"
        >
          Disconnect Neon
        </button>
      </div>
      {error && <div className="modal-error">{error}</div>}
      {projects.length === 0 ? (
        <div className="section-note">No Neon projects.</div>
      ) : (
        projects.map((proj) => {
          const projOpen = !!expanded[proj.id];
          return (
            <div key={proj.id} className="db-entry">
              <button
                type="button"
                className="db-row"
                onClick={() => expandProject(proj.id)}
                title={proj.name}
              >
                <i
                  className={`codicon codicon-chevron-${projOpen ? "down" : "right"}`}
                />
                <span className="db-name">{proj.name}</span>
              </button>
              {projOpen && (
                <div className="neon-children">
                  {branches[proj.id]?.length === 0 ? (
                    <div className="section-note">no branches</div>
                  ) : (
                    branches[proj.id]?.map((br) => {
                      const bKey = `${proj.id}/${br.id}`;
                      const brOpen = !!expanded[bKey];
                      return (
                        <div key={br.id} className="db-entry">
                          <button
                            type="button"
                            className="db-row"
                            onClick={() => expandBranch(proj.id, br.id)}
                            title={br.name}
                          >
                            <i
                              className={`codicon codicon-chevron-${brOpen ? "down" : "right"}`}
                            />
                            <span className="db-name">{br.name}</span>
                          </button>
                          {brOpen && (
                            <div className="neon-children">
                              {databases[bKey]?.length === 0 ? (
                                <div className="section-note">no databases</div>
                              ) : (
                                databases[bKey]?.map((db) => {
                                  const dKey = `${bKey}/${db.name}`;
                                  const dbOpen = !!expanded[dKey];
                                  const state = pings[dKey] ?? "checking";
                                  const dotClass =
                                    state === "ok"
                                      ? "status-dot on"
                                      : state === "fail"
                                        ? "status-dot fail"
                                        : "status-dot";
                                  return (
                                    <div key={db.name} className="db-entry">
                                      <button
                                        type="button"
                                        className="db-row"
                                        onClick={() =>
                                          expandDatabase(proj.id, br.id, db)
                                        }
                                        title={`${db.name} (${db.ownerName})`}
                                      >
                                        <i
                                          className={`codicon codicon-chevron-${dbOpen ? "down" : "right"}`}
                                        />
                                        <span className={dotClass} />
                                        <span className="db-name">
                                          {db.name}
                                        </span>
                                      </button>
                                      {dbOpen && (
                                        <div className="db-tables">
                                          {tables[dKey]?.length === 0 ? (
                                            <div className="section-note">
                                              no tables
                                            </div>
                                          ) : (
                                            tables[dKey]?.map((t) => (
                                              <button
                                                key={`${t.schema}.${t.name}`}
                                                type="button"
                                                className="db-table-row"
                                                onClick={() =>
                                                  openTable(
                                                    proj.id,
                                                    br.id,
                                                    db,
                                                    t,
                                                  )
                                                }
                                                title={`Browse ${t.schema}.${t.name}`}
                                              >
                                                <i className="codicon codicon-table" />
                                                <span className="db-table-name">
                                                  {t.schema}.{t.name}
                                                </span>
                                              </button>
                                            ))
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
