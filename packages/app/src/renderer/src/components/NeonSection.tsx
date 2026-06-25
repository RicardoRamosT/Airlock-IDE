import { useEffect, useRef, useState } from "react";
import type {
  DbTable,
  NeonAccountRef,
  NeonBranch,
  NeonDatabase,
  NeonOrg,
  NeonProject,
} from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

type PingState = "checking" | "ok" | "fail";

// Turn a failed orgs/projects fetch into actionable guidance. Personal and
// organization keys both work (main resolves either); only a PROJECT-SCOPED key
// can't enumerate projects and 404s — so point the user at a non-scoped key
// rather than showing the raw "Neon API 404".
function listErrorHint(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/\b40[34]\b|not found|forbidden/i.test(msg))
    return "Couldn't list your Neon projects — this usually means a project-scoped API key, which can't browse projects. Use a personal or organization API key (Neon → Account settings → API keys) and reconnect.";
  return msg;
}

// A lazy Neon tree mirroring DatabasesSection's fetch-on-expand + status-dot
// patterns. Neon migrated all accounts to organizations, so the tree is rooted
// at the org level; each level is fetched only when its parent expands and
// cached in a keyed Record so re-expanding is free:
//   organizations                     neonOrgs()
//   -> projects    key: orgId         neonProjects(orgId)
//   -> branches    key: projectId     neonBranches(projectId)
//   -> databases   key: p/b           neonDatabases(projectId, branchId)
//   -> tables      key: p/b/db        neonTables(projectId, branchId, db, role)
// Project ids are globally unique, so branches/databases/tables stay keyed by
// them regardless of org. Each database self-pings on first appearance for its
// status dot; the database's `role` is its ownerName. Clicking a table sets
// dbView{kind:"neon"}; the DataGrid fetches rows reactively from that.
export function NeonSection() {
  const modal = useApp((s) => s.modal);
  // Multi-account: this project's resolved account + the full pool (switcher).
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [resolved, setResolved] = useState(false);
  const [account, setAccount] = useState<NeonAccountRef | null>(null);
  const [accounts, setAccounts] = useState<NeonAccountRef[]>([]);
  const [orgs, setOrgs] = useState<NeonOrg[]>([]);
  const [projects, setProjects] = useState<Record<string, NeonProject[]>>({});
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

  // Resolve THIS project's Neon account + the pool: on mount, whenever the
  // modal closes (so the tree appears right after picking/adding), and on
  // project switch (root changes) so airlock and Xipa show their own account.
  // biome-ignore lint/correctness/useExhaustiveDependencies: root is a trigger (resolution is main-side via rootForEvent); re-resolve on project switch.
  useEffect(() => {
    if (modal !== null) return;
    let cancelled = false;
    Promise.all([
      window.airlock.neonResolveAccount(),
      window.airlock.neonAccounts(),
    ])
      .then(([acct, pool]) => {
        if (cancelled || !mounted.current) return;
        setAccount(acct);
        setAccounts(pool);
        setResolved(true);
      })
      .catch(() => {
        if (mounted.current) setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [modal, root]);

  // Drop the previous project's tree immediately on switch so it never lingers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: root is the trigger; reset the lazy tree on project switch.
  useEffect(() => {
    setOrgs([]);
    setProjects({});
    setBranches({});
    setDatabases({});
    setTables({});
    setExpanded({});
    setError(null);
  }, [root]);

  // Once an account resolves, load its organization list (the top of the tree).
  useEffect(() => {
    if (!account) return;
    window.airlock
      .neonOrgs()
      .then((o) => {
        if (mounted.current) {
          setOrgs(o);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (mounted.current) {
          console.error("neonOrgs failed", e);
          setError(listErrorHint(e));
        }
      });
  }, [account]);

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

  const expandOrg = (orgId: string) => {
    const wasOpen = !!expanded[orgId];
    toggle(orgId);
    if (wasOpen || projects[orgId]) return;
    window.airlock
      .neonProjects(orgId)
      .then((p) => {
        if (mounted.current) setProjects((m) => ({ ...m, [orgId]: p }));
      })
      .catch((e: unknown) => {
        console.error("neonProjects failed", orgId, e);
        if (mounted.current)
          setError(e instanceof Error ? e.message : String(e));
      });
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

  // Switch this project to another connected account, or open the manager (add /
  // remove keys) via the Connect-Neon modal.
  const pickAccount = (value: string) => {
    if (value === "__manage__") {
      useApp.getState().setModal("connect-neon");
      return;
    }
    if (value === account?.id) return;
    void window.airlock.neonSetProjectAccount(value).then(() => {
      void window.airlock.neonResolveAccount().then((a) => {
        if (!mounted.current) return;
        setAccount(a);
        setOrgs([]);
        setExpanded({});
        setError(null);
      });
    });
  };

  if (!resolved) return <div className="section-note">checking…</div>;

  // No account resolves for this project (none bound, or unbound with several).
  // Open the picker: choose an existing account or add a new key for it.
  if (!account) {
    return (
      <div className="databases">
        <button
          type="button"
          className="btn"
          onClick={() => useApp.getState().setModal("connect-neon")}
        >
          {accounts.length > 0 ? "Pick a Neon account" : "Connect Neon"}
        </button>
      </div>
    );
  }

  return (
    <div className="databases">
      <div
        className="neon-account-row"
        title={`Neon account: ${account.label}`}
      >
        <i className="codicon codicon-account" />
        <select
          className="sb-control"
          value={account.id}
          onChange={(e) => pickAccount(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          <option value="__manage__">Manage accounts…</option>
        </select>
      </div>
      {error && <div className="modal-error">{error}</div>}
      {!error && orgs.length === 0 ? (
        <div className="section-note">No Neon organizations.</div>
      ) : (
        orgs.map((org) => {
          const orgOpen = !!expanded[org.id];
          return (
            <div key={org.id} className="db-entry">
              <button
                type="button"
                className="db-row"
                onClick={() => expandOrg(org.id)}
                title={org.name}
              >
                <i
                  className={`codicon codicon-chevron-${orgOpen ? "down" : "right"}`}
                />
                <i className="codicon codicon-organization" />
                <span className="db-name">{org.name}</span>
              </button>
              {orgOpen && (
                <div className="neon-children">
                  {projects[org.id]?.length === 0 ? (
                    <div className="section-note">no projects</div>
                  ) : (
                    projects[org.id]?.map((proj) => {
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
                                        onClick={() =>
                                          expandBranch(proj.id, br.id)
                                        }
                                        title={br.name}
                                      >
                                        <i
                                          className={`codicon codicon-chevron-${brOpen ? "down" : "right"}`}
                                        />
                                        <span className="db-name">
                                          {br.name}
                                        </span>
                                      </button>
                                      {brOpen && (
                                        <div className="neon-children">
                                          {databases[bKey]?.length === 0 ? (
                                            <div className="section-note">
                                              no databases
                                            </div>
                                          ) : (
                                            databases[bKey]?.map((db) => {
                                              const dKey = `${bKey}/${db.name}`;
                                              const dbOpen = !!expanded[dKey];
                                              const state =
                                                pings[dKey] ?? "checking";
                                              const dotClass =
                                                state === "ok"
                                                  ? "status-dot on"
                                                  : state === "fail"
                                                    ? "status-dot fail"
                                                    : "status-dot";
                                              return (
                                                <div
                                                  key={db.name}
                                                  className="db-entry"
                                                >
                                                  <button
                                                    type="button"
                                                    className="db-row"
                                                    onClick={() =>
                                                      expandDatabase(
                                                        proj.id,
                                                        br.id,
                                                        db,
                                                      )
                                                    }
                                                    title={`${db.name} (${db.ownerName})`}
                                                  >
                                                    <i
                                                      className={`codicon codicon-chevron-${dbOpen ? "down" : "right"}`}
                                                    />
                                                    <span
                                                      className={dotClass}
                                                    />
                                                    <span className="db-name">
                                                      {db.name}
                                                    </span>
                                                  </button>
                                                  {dbOpen && (
                                                    <div className="db-tables">
                                                      {tables[dKey]?.length ===
                                                      0 ? (
                                                        <div className="section-note">
                                                          no tables
                                                        </div>
                                                      ) : (
                                                        tables[dKey]?.map(
                                                          (t) => (
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
                                                                {t.schema}.
                                                                {t.name}
                                                              </span>
                                                            </button>
                                                          ),
                                                        )
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
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
