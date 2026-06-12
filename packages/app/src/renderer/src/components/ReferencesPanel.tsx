// packages/app/src/renderer/src/components/ReferencesPanel.tsx
import { useEffect } from "react";
import { openEditorFile } from "../lib/editorFiles";
import { useApp } from "../store";

// Window-level overlay for Find All References results, mirroring SearchPanel:
// gated on the `references` store slice, Esc/backdrop to dismiss, file-grouped
// rows (line + snippet) that jump on click.
export function ReferencesPanel() {
  const activeTabId = useApp((s) => s.activeTabId);
  const references = useApp((s) => s.references);
  const closeReferences = useApp((s) => s.closeReferences);

  useEffect(() => {
    if (!references) return; // only listen while the overlay is open
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeReferences();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [references, closeReferences]);

  if (!references) return null;
  const { symbol, results } = references;
  const total = results.reduce((n, f) => n + f.hits.length, 0);

  return (
    <>
      <button
        type="button"
        className="palette-backdrop"
        aria-label="Close references"
        onClick={() => closeReferences()}
      />
      <div className="search-panel" role="dialog" aria-modal="true">
        <div className="search-file-head">
          References to <strong>{symbol || "symbol"}</strong>{" "}
          <span className="search-count">{total}</span>
        </div>
        <div className="search-results">
          {total === 0 && (
            <div className="search-empty">No references found</div>
          )}
          {results.map((f) => (
            <div key={f.relPath} className="search-file">
              <div className="search-file-head">
                {f.relPath}{" "}
                <span className="search-count">{f.hits.length}</span>
              </div>
              {f.hits.map((h) => (
                <button
                  type="button"
                  key={`${h.line}:${h.character}`}
                  className="search-row"
                  onClick={() => {
                    void openEditorFile(activeTabId, f.relPath, h.line);
                    closeReferences();
                  }}
                >
                  <span className="search-line">{h.line}</span>
                  <span className="search-preview">{h.snippet}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
