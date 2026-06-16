import { useEffect, useState } from "react";
import type { QueryResult } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

const MAX_CELL = 200; // chars before a string cell is truncated (full text in title)

// Render one cell value for display. null/undefined become a dim "null";
// objects/arrays are JSON-stringified; long strings are truncated with the
// full value preserved in the title attribute. Read-only -- never edited.
function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="data-grid-null">null</span>;
  }
  let text: string;
  if (typeof value === "object") {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }
  if (text.length > MAX_CELL) {
    return <span title={text}>{`${text.slice(0, MAX_CELL)}…`}</span>;
  }
  return <span>{text}</span>;
}

export function DataGrid() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const dbView = useApp((s) => s.tabState[tabId]?.dbView ?? null);
  const closeDbTab = useApp((s) => s.closeDbTab);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dbView) return;
    const view = dbView;
    // The secret-vaulted DB branch is per-project: it needs the pane's root.
    // (The neon branch is account-global and takes no root.) A secret dbView is
    // only ever set when this pane has a project open, so root is present here.
    if (view.kind === "secret" && !root) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    const rows =
      view.kind === "neon"
        ? window.airlock.neonRows(
            view.projectId,
            view.branchId,
            view.database,
            view.role,
            view.schema,
            view.table,
            100,
          )
        : window.airlock.dbRows(
            root as string,
            view.id,
            view.schema,
            view.table,
            100,
          );
    rows
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error("dbRows failed", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dbView, root]);

  if (!dbView) return null;

  return (
    <div className="data-grid">
      <div className="data-grid-header">
        <span>
          {dbView.schema}.{dbView.table}
        </span>
        {result && (
          <span className="badge dim-badge">
            {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="badge dim-badge">read-only</span>
        <button
          type="button"
          className="viewer-close"
          onClick={() => {
            if (dbView) closeDbTab(dbView, tabId);
          }}
          title="Close table"
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
      <div className="data-grid-body">
        {loading && <div className="section-note">loading…</div>}
        {error && <div className="modal-error">{error}</div>}
        {!loading && !error && result && (
          <table>
            <thead>
              <tr>
                {result.columns.map((c, i) => (
                  // Column names can repeat (e.g. a join); index disambiguates.
                  // The result is immutable for one fetch, so position is stable.
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable column order per fetch
                  <th key={`${c}-${i}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, ri) => (
                // Rows have no stable id; row order is fixed for one fetch.
                // biome-ignore lint/suspicious/noArrayIndexKey: stable row order per fetch
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable cell order per fetch
                    <td key={`${ri}-${ci}`}>
                      <Cell value={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
