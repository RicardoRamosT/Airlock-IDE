import { useState } from "react";
import type { Scope } from "../lib/editorScopes";

export type SaveState = "idle" | "unsaved" | "saved" | "conflict";

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
// The ESLint chip beside the save state. Absent = ESLint does not govern this
// file (or is not enabled for it), and nothing is shown at all.
export interface EslintChip {
  label: string;
  tone: "ok" | "problems" | "busy" | "error";
  /** Tooltip: the config error's first line, never painted into the file. */
  title?: string;
  onJump?: () => void;
  onDisable?: () => void;
}

export function EditorBreadcrumb({
  pathSegments,
  symbolTrail,
  saveState,
  truncated,
  onSymbolClick,
  eslint,
}: {
  pathSegments: string[];
  symbolTrail: Scope[];
  saveState: SaveState;
  truncated: boolean;
  onSymbolClick: (scope: Scope) => void;
  eslint?: EslintChip;
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
      {eslint && <EslintStatusChip chip={eslint} />}
      <div className="editor-status" aria-live="polite">
        {truncated ? (
          <span className="badge">too large to edit (first 1 MB)</span>
        ) : saveState === "unsaved" ? (
          <span className="editor-dot" title="Unsaved, autosaving">
            unsaved
          </span>
        ) : saveState === "saved" ? (
          <span className="editor-saved">saved</span>
        ) : saveState === "conflict" ? (
          <span className="editor-conflict" title="Changed on disk, not saved">
            changed on disk
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EslintStatusChip({ chip }: { chip: EslintChip }) {
  const [open, setOpen] = useState(false);
  const act = (fn?: () => void) => () => {
    setOpen(false);
    fn?.();
  };
  return (
    <div className="eslint-chip-wrap">
      <button
        type="button"
        className={`eslint-chip eslint-${chip.tone}`}
        title={chip.title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {chip.label}
      </button>
      {open && (
        <div className="eslint-menu" role="menu">
          {chip.onJump && (
            <button type="button" role="menuitem" onClick={act(chip.onJump)}>
              Go to first problem
            </button>
          )}
          {chip.onDisable && (
            <button type="button" role="menuitem" onClick={act(chip.onDisable)}>
              Disable ESLint for this folder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
