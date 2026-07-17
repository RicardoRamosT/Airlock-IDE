import type { Scope } from "../lib/editorScopes";

export type SaveState = "idle" | "unsaved" | "saved";

// Slim VS Code-style bar under the tab: path segments on the left, the symbol
// trail (from the scope chain at the cursor) next, and save state on the
// right -- this replaces the old floating .editor-status badge, which is now
// a normal flex child here instead of absolutely positioned. Presentation
// only -- EditorPane computes the segments/trail and owns the symbol-click
// navigation.
//
// Path segments are plain (non-interactive) text for v1: there is no
// file-tree-reveal store action to wire a click to -- the store's
// `reveal`/`revealLine` is an EDITOR-LINE reveal consumed by EditorPane
// itself, not a file-tree reveal, so inventing a click target here would
// either no-op silently or require a new store action out of scope for this
// task. The symbol trail IS wired: clicking a symbol scrolls the editor to it.
export function EditorBreadcrumb({
  pathSegments,
  symbolTrail,
  saveState,
  truncated,
  onSymbolClick,
}: {
  pathSegments: string[];
  symbolTrail: Scope[];
  saveState: SaveState;
  truncated: boolean;
  onSymbolClick: (scope: Scope) => void;
}) {
  return (
    <div className="editor-breadcrumb">
      <div className="breadcrumb-trail">
        {pathSegments.map((seg, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: path segments are stable within a file
          <span className="breadcrumb-seg breadcrumb-path" key={`p${i}-${seg}`}>
            {seg}
          </span>
        ))}
        {symbolTrail.map((s) => (
          <button
            type="button"
            className={`breadcrumb-seg breadcrumb-sym kind-${s.kind}`}
            key={`s-${s.line}-${s.name}`}
            onClick={() => onSymbolClick(s)}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className="editor-status" aria-live="polite">
        {truncated ? (
          <span className="badge">too large to edit (first 1 MB)</span>
        ) : saveState === "unsaved" ? (
          <span className="editor-dot" title="Unsaved - autosaving">
            unsaved
          </span>
        ) : saveState === "saved" ? (
          <span className="editor-saved">saved</span>
        ) : null}
      </div>
    </div>
  );
}
