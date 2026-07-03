import { useEffect, useState } from "react";
import type { WorkbookData } from "../../../shared/ipc"; // import type only

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: WorkbookData }
  | { kind: "too-large" }
  | { kind: "error" };

export function ExcelViewer({
  root,
  relPath,
}: {
  root: string;
  relPath: string;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setSheet(0);
    window.airlock
      .readWorkbook(root, relPath)
      .then((d) => {
        if (cancelled) return;
        setState(d.tooLarge ? { kind: "too-large" } : { kind: "ok", data: d });
      })
      .catch((err) => {
        console.error("readWorkbook failed", err);
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [root, relPath]);

  if (state.kind === "loading")
    return <div className="viewer-host empty">loading…</div>;
  if (state.kind === "ok") {
    const { sheets } = state.data;
    if (sheets.length === 0)
      return <div className="viewer-host empty">Empty workbook.</div>;
    const s = sheets[Math.min(sheet, sheets.length - 1)]!;
    return (
      <div className="xlsx-viewer-host">
        {sheets.length > 1 && (
          <div className="xlsx-sheet-tabs">
            {sheets.map((sh, i) => (
              <button
                key={sh.name}
                type="button"
                className={i === sheet ? "active" : ""}
                onClick={() => setSheet(i)}
              >
                {sh.name}
              </button>
            ))}
          </div>
        )}
        <div className="xlsx-grid-scroll">
          <table className="xlsx-grid">
            <colgroup>
              {s.colWidths.map((w, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: column index is stable
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <tbody>
              {s.rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: row index is stable
                <tr key={r}>
                  {row.map((cell, c) =>
                    cell === null ? null : (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: cell index is stable
                        key={c}
                        colSpan={cell.colspan}
                        rowSpan={cell.rowspan}
                        style={{
                          fontWeight: cell.bold ? 700 : undefined,
                          fontStyle: cell.italic ? "italic" : undefined,
                          color: cell.color,
                          background: cell.fill,
                          textAlign: cell.align,
                        }}
                      >
                        {cell.value}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return (
    <div className="binary-notice">
      <div>
        {state.kind === "too-large"
          ? "Spreadsheet too large to preview."
          : "Could not preview this spreadsheet."}
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => void window.airlock.openExternalFile(root, relPath)}
      >
        Open externally
      </button>
    </div>
  );
}
