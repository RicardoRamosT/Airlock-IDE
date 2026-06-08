import { useEffect, useMemo, useRef, useState } from "react";
import { buildCommands, type Command } from "../lib/commands";
import { openEditorFile } from "../lib/editorFiles";
import { type FuzzyMatch, fuzzyFilter } from "../lib/fuzzy";
import { useApp } from "../store";

// File list cache keyed by `${root} ${fsVersion}`, so a watcher bump invalidates
// it transparently. Module-level: survives a palette reopen.
const fileCache = new Map<string, { files: string[]; truncated: boolean }>();

// Render `text` with matched indices bolded.
function Highlight({ text, indices }: { text: string; indices: number[] }) {
  const set = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: char positions are stable for a fixed string
          <b key={i}>{ch}</b>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: char positions are stable for a fixed string
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

type Row =
  | { kind: "file"; path: string; match: FuzzyMatch }
  | { kind: "command"; cmd: Command; match: FuzzyMatch };

export function Palette() {
  const palette = useApp((s) => s.palette);
  if (!palette) return null;
  // Remount per open (key by mode) so query/selection reset each time.
  return <PaletteInner key={palette.mode} mode={palette.mode} />;
}

function PaletteInner({ mode }: { mode: "files" | "commands" }) {
  const closePalette = useApp((s) => s.closePalette);
  const openPalette = useApp((s) => s.openPalette);
  const activeTabId = useApp((s) => s.activeTabId);
  const root = useApp((s) => s.tabState[activeTabId]?.root ?? null);
  const fsVersion = useApp((s) => (root ? (s.fsVersion[root] ?? 0) : 0));

  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<{ files: string[]; truncated: boolean }>({
    files: [],
    truncated: false,
  });
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // commands mode = opened that way OR a leading ">" in files mode.
  const commandsMode = mode === "commands" || query.startsWith(">");
  const q = commandsMode ? query.replace(/^>/, "").trimStart() : query;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load + cache the project's file list when in files mode.
  useEffect(() => {
    if (commandsMode || !root) return;
    const cacheKey = `${root} ${fsVersion}`;
    const cached = fileCache.get(cacheKey);
    if (cached) {
      setFiles(cached);
      return;
    }
    let cancelled = false;
    window.airlock
      .listAllFiles(root)
      .then((r) => {
        if (cancelled) return;
        fileCache.set(cacheKey, r);
        setFiles(r);
        if (r.truncated)
          console.warn(`[palette] file list truncated at ${r.files.length}`);
      })
      .catch((err) => console.error("listAllFiles failed", err));
    return () => {
      cancelled = true;
    };
  }, [commandsMode, root, fsVersion]);

  const results: Row[] = useMemo(() => {
    if (commandsMode) {
      const cmds = buildCommands(useApp.getState(), () => openPalette("files"));
      return fuzzyFilter(q, cmds, (c) => c.title).map(({ item, match }) => ({
        kind: "command",
        cmd: item,
        match,
      }));
    }
    return fuzzyFilter(q, files.files, (f) => f).map(({ item, match }) => ({
      kind: "file",
      path: item,
      match,
    }));
  }, [commandsMode, q, files, openPalette]);

  const clamped = results.length ? Math.min(sel, results.length - 1) : 0;

  const run = (i: number) => {
    const r = results[i];
    closePalette(); // always close, even if the action throws
    if (!r) return;
    try {
      const p =
        r.kind === "command"
          ? r.cmd.run()
          : openEditorFile(activeTabId, r.path);
      if (p) p.catch((err) => console.error("palette action failed", err));
    } catch (err) {
      console.error("palette action failed", err);
    }
  };

  return (
    <>
      <button
        type="button"
        className="palette-backdrop"
        aria-label="Close palette"
        onClick={closePalette}
      />
      <div className="palette" role="dialog" aria-modal="true">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder={commandsMode ? "Run a command..." : "Go to file..."}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => (results.length ? (s + 1) % results.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) =>
                results.length ? (s - 1 + results.length) % results.length : 0,
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(clamped);
            } else if (e.key === "Escape") {
              e.preventDefault();
              closePalette();
            }
          }}
        />
        <div className="palette-list">
          {results.map((r, i) => (
            <button
              type="button"
              key={r.kind === "file" ? `f:${r.path}` : `c:${r.cmd.id}`}
              className={`palette-row${i === clamped ? " selected" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(i)}
            >
              {r.kind === "file" ? (
                <Highlight text={r.path} indices={r.match.indices} />
              ) : (
                <Highlight text={r.cmd.title} indices={r.match.indices} />
              )}
            </button>
          ))}
          {results.length === 0 && (
            <div className="palette-empty">No results</div>
          )}
        </div>
        {!commandsMode && files.truncated && (
          <div className="palette-foot">
            showing first {files.files.length} files
          </div>
        )}
      </div>
    </>
  );
}
