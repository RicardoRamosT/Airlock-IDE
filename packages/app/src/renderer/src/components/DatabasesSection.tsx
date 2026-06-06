import { useCallback, useEffect, useState } from "react";
import type { DbEntry, DbTable } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

type PingState = "checking" | "ok" | "fail";

export function DatabasesSection() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [dbs, setDbs] = useState<DbEntry[]>([]);
  const [pings, setPings] = useState<Record<string, PingState>>({});
  const [tables, setTables] = useState<Record<string, DbTable[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  // List the vaulted Postgres DBs, then ping each one. Pings run in parallel
  // and stream their results into `pings` as they resolve, so a slow/unreachable
  // DB does not block the others from going green.
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
  }, [root]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  if (!root) return <div className="section-note">open a folder first</div>;

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
      .setDbView(
        { kind: "secret", id, schema: t.schema, table: t.name },
        tabId,
      );
  };

  return (
    <div className="databases">
      <div className="db-toolbar">
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
        <div className="section-note">
          No databases. Vault a Postgres connection string in Secrets.
        </div>
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
