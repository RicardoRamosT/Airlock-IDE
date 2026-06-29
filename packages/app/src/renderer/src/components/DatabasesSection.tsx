import { useCallback, useEffect, useState } from "react";
import type { DbEntry, DbTable } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { OpenFolderEmpty } from "./OpenFolderEmpty";

type PingState = "checking" | "ok" | "fail";

export function DatabasesSection() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const setModal = useApp((s) => s.setModal);
  const dbRefreshNonce = useApp((s) => s.dbRefreshNonce);
  const [dbs, setDbs] = useState<DbEntry[]>([]);
  const [pings, setPings] = useState<Record<string, PingState>>({});
  const [tables, setTables] = useState<Record<string, DbTable[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  // List the vaulted Postgres DBs, then ping each one. Pings run in parallel
  // and stream their results into `pings` as they resolve, so a slow/unreachable
  // DB does not block the others from going green.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dbRefreshNonce is not read in the body but intentionally included as a trigger dep — bumping it forces a refresh after a new DB secret is saved.
  const refresh = useCallback(async () => {
    if (!root) return;
    setBusy(true);
    try {
      const list = await window.airlock.dbList(root);
      setDbs(list);
      setPings(Object.fromEntries(list.map((d) => [d.id, "checking"])));
      // Drop any cached tables for DBs that vanished; collapse all rows so a
      // refresh re-fetches tables on next expand.
      setTables({});
      setExpanded({});
      await Promise.all(
        list.map(async (d) => {
          try {
            const r = await window.airlock.dbPing(root, d.id);
            setPings((p) => ({ ...p, [d.id]: r.ok ? "ok" : "fail" }));
          } catch (err) {
            console.error("dbPing failed", d.id, err);
            setPings((p) => ({ ...p, [d.id]: "fail" }));
          }
        }),
      );
    } catch (err) {
      console.error("dbList failed", err);
    } finally {
      setBusy(false);
    }
  }, [root, dbRefreshNonce]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  if (!root) return <OpenFolderEmpty />;

  const toggle = async (id: string) => {
    const next = !expanded[id];
    setExpanded((e) => ({ ...e, [id]: next }));
    // Lazily fetch the table list the first time a DB is expanded.
    if (next && !tables[id]) {
      setBusy(true);
      try {
        const t = await window.airlock.dbTables(root, id);
        setTables((m) => ({ ...m, [id]: t }));
      } catch (err) {
        console.error("dbTables failed", id, err);
      } finally {
        setBusy(false);
      }
    }
  };

  const openTable = (id: string, t: DbTable) => {
    useApp
      .getState()
      .openDbTable(
        { kind: "secret", id, schema: t.schema, table: t.name },
        tabId,
      );
  };

  // Remove a database = delete its vaulted connection-string secret. Confirmed
  // because it permanently drops the stored credentials; refresh() re-lists.
  const removeDb = async (id: string) => {
    if (!root) return;
    if (
      !window.confirm(
        `Remove database "${id}"? This deletes its stored connection string.`,
      )
    )
      return;
    try {
      await window.airlock.secretsDelete(root, id);
    } catch (err) {
      console.error("secretsDelete failed", id, err);
    }
    await refresh();
  };

  return (
    <div className="databases">
      <div className="section-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => setModal("add-database")}
          title="Add a database by pasting a Postgres connection string"
        >
          + Add database
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void refresh()}
          disabled={busy}
          title="Refresh databases and re-check status"
        >
          ↻ Refresh
        </button>
      </div>
      {dbs.length === 0 ? (
        <button
          type="button"
          className="section-empty"
          onClick={() => setModal("add-database")}
        >
          No databases yet — click to add one with a connection string.
        </button>
      ) : (
        dbs.map((d) => {
          const state = pings[d.id] ?? "checking";
          const dotClass =
            state === "ok"
              ? "status-dot on"
              : state === "fail"
                ? "status-dot fail"
                : "status-dot";
          const open = !!expanded[d.id];
          return (
            <div key={d.id} className="db-entry">
              <div className="db-entry-head">
                <button
                  type="button"
                  className="db-row"
                  onClick={() => void toggle(d.id)}
                  disabled={busy}
                  title={d.redacted}
                >
                  <i
                    className={`codicon codicon-chevron-${open ? "down" : "right"}`}
                  />
                  <span className={dotClass} />
                  <span className="db-name">{d.id}</span>
                  <span className="db-host">{d.host}</span>
                </button>
                <button
                  type="button"
                  className="row-action reveal"
                  onClick={() => void removeDb(d.id)}
                  disabled={busy}
                  title="Remove this database (deletes its stored connection string)"
                >
                  <i className="codicon codicon-trash" />
                </button>
              </div>
              {open && (
                <div className="db-tables">
                  {tables[d.id]?.length === 0 ? (
                    <div className="section-note">no tables</div>
                  ) : (
                    tables[d.id]?.map((t) => (
                      <button
                        key={`${t.schema}.${t.name}`}
                        type="button"
                        className="db-table-row"
                        onClick={() => openTable(d.id, t)}
                        disabled={busy}
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
  );
}
