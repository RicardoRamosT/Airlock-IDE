import { useEffect, useRef, useState } from "react";
import { openEditorFile } from "../lib/editorFiles";
import { useApp } from "../store";

// Highlight the matched span [col, col+len) within a preview line.
function Preview({
  text,
  col,
  len,
}: {
  text: string;
  col: number;
  len: number;
}) {
  if (col < 0 || col >= text.length)
    return <span className="search-preview">{text}</span>;
  return (
    <span className="search-preview">
      {text.slice(0, col)}
      <b>{text.slice(col, col + len)}</b>
      {text.slice(col + len)}
    </span>
  );
}

// Window-level find-in-files overlay (mounted in App, gated on searchOpen). Reads
// the active project, searches on Enter, persists query+results in the store so
// reopening is instant, and opens a result at its line.
export function SearchPanel() {
  const activeTabId = useApp((s) => s.activeTabId);
  const root = useApp((s) => s.tabState[activeTabId]?.root ?? null);
  const search = useApp((s) => s.search);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const setSearchResults = useApp((s) => s.setSearchResults);
  const [query, setQuery] = useState(search?.query ?? "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const run = async () => {
    const q = query.trim();
    if (!q || !root || busy) return;
    setBusy(true);
    try {
      const results = await window.airlock.searchProject(root, q);
      setSearchResults(q, results);
    } catch (err) {
      console.error("search failed", err);
      setSearchResults(q, { files: [], truncated: false });
    } finally {
      setBusy(false);
    }
  };

  const results = search?.results ?? null;
  const total = results?.files.reduce((n, f) => n + f.matches.length, 0) ?? 0;

  return (
    <>
      <button
        type="button"
        className="palette-backdrop"
        aria-label="Close search"
        onClick={() => setSearchOpen(false)}
      />
      <div className="search-panel" role="dialog" aria-modal="true">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="Search in files..."
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setSearchOpen(false);
            }
          }}
        />
        <div className="search-results">
          {busy && <div className="search-empty">searching…</div>}
          {!busy && results && total === 0 && (
            <div className="search-empty">No results</div>
          )}
          {!busy &&
            results?.files.map((f) => (
              <div key={f.path} className="search-file">
                <div className="search-file-head">
                  {f.path}{" "}
                  <span className="search-count">{f.matches.length}</span>
                </div>
                {f.matches.map((m) => (
                  <button
                    type="button"
                    key={`${m.line}:${m.col}`}
                    className="search-row"
                    onClick={() => {
                      void openEditorFile(activeTabId, f.path, m.line);
                      setSearchOpen(false);
                    }}
                  >
                    <span className="search-line">{m.line}</span>
                    <Preview
                      text={m.preview}
                      col={m.col}
                      len={query.trim().length}
                    />
                  </button>
                ))}
              </div>
            ))}
          {results?.truncated && (
            <div className="search-foot">showing first {total} matches</div>
          )}
        </div>
      </div>
    </>
  );
}
