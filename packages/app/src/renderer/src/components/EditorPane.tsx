import {
  autocompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef, useState } from "react";
import type { FileContent, LspCompletionItem } from "../../../shared/ipc";
import { openEditorFile } from "../lib/editorFiles";
import { languageExtensionForPath } from "../lib/language";
import { toCmCompletions } from "../lib/lspCompletions";
import { toCmDiagnostics } from "../lib/lspDiagnostics";
import { lspLanguageId } from "../lib/lspLanguage";
import { positionAt } from "../lib/lspPositions";
import { useApp } from "../store";

// Autosave: write the file this long after the last keystroke. A switch/unmount
// flushes immediately (the effect cleanup), so nothing is lost on navigation.
const AUTOSAVE_MS = 800;
// Debounce window for pushing full-text changes to the language server.
const LSP_DEBOUNCE_MS = 300;
type SaveState = "idle" | "unsaved" | "saved";

// LSP completion + hover for one open file. Both first call `sync` to push the
// current document to the server, THEN query at the cursor. The sync is what
// makes member completion (e.g. `foo.`) work: a keystroke fires the query
// immediately, but didChange is debounced, so without this the server is still
// on the PREVIOUS text and answers a member query with top-level completions --
// which CodeMirror filters out against the typed prefix, leaving an empty menu.
// (Offset -> LSP position via positionAt.)
export function makeLspCompletionSource(
  root: string,
  relPath: string,
  sync: () => Promise<void>,
): CompletionSource {
  return async (context) => {
    const word = context.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    try {
      await sync();
    } catch (err) {
      // A failed sync shouldn't suppress completion; the server may still answer.
      console.error("[lsp] document sync before completion failed", err);
    }
    const { line, character } = positionAt(
      context.state.doc.toString(),
      context.pos,
    );
    let items: LspCompletionItem[];
    try {
      items = await window.airlock.lspCompletion(
        root,
        relPath,
        line,
        character,
      );
    } catch (err) {
      console.error("[lsp] completion request failed", err);
      return null;
    }
    if (items.length === 0) return null;
    return {
      from: word.from,
      options: toCmCompletions(items),
      validFor: /[\w$]*/,
    };
  };
}

export function makeLspHover(
  root: string,
  relPath: string,
  sync: () => Promise<void>,
): Extension {
  return hoverTooltip(async (view, pos) => {
    try {
      await sync();
    } catch (err) {
      console.error("[lsp] document sync before hover failed", err);
    }
    const { line, character } = positionAt(view.state.doc.toString(), pos);
    const r = await window.airlock.lspHover(root, relPath, line, character);
    if (!r) return null;
    return {
      pos,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-lsp-hover";
        dom.textContent = r.contents;
        return { dom };
      },
    };
  });
}

// Jump to a symbol's definition. Flushes the document to the server first (like
// completion/hover), asks for textDocument/definition, and reuses openEditorFile
// to open/switch + reveal the target. A null result (no def, non-symbol, or a
// target outside the workspace) is a silent no-op.
export async function goToDefinition(
  root: string,
  relPath: string,
  tabId: string,
  sync: () => Promise<void>,
  docText: string,
  pos: number,
): Promise<void> {
  try {
    await sync();
    const { line, character } = positionAt(docText, pos);
    const def = await window.airlock.lspDefinition(
      root,
      relPath,
      line,
      character,
    );
    if (def) await openEditorFile(tabId, def.relPath, def.line);
  } catch (err) {
    console.error("[lsp] go-to-definition failed", err);
  }
}

// Editable CodeMirror with debounced autosave. One instance per open file
// (keyed by the caller on the path), so switching files remounts this and the
// cleanup flushes the outgoing file. A TRUNCATED file (read cap exceeded) is
// shown read-only -- saving a prefix would destroy the rest on disk.
export function EditorPane({
  tabId,
  root,
  relPath,
  file,
  theme,
}: {
  tabId: string;
  root: string;
  relPath: string;
  file: FileContent;
  theme: "dark" | "light";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const reveal = useApp((s) => s.reveal);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const editable = !file.truncated;
  const lspLang = lspLanguageId(relPath);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setSaveState("idle");

    let timer: ReturnType<typeof setTimeout> | undefined;
    let lspTimer: ReturnType<typeof setTimeout> | undefined;
    let lspVersion = 1;
    let dirty = false;

    // Write pending edits now. Clears the debounce timer; no-op when clean.
    const flush = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (!dirty) return;
      dirty = false;
      void window.airlock
        .writeFile(root, relPath, view.state.doc.toString())
        .then(() => setSaveState("saved"))
        .catch((err) => {
          console.error("autosave failed", err);
          dirty = true; // retry on the next edit or flush
          setSaveState("unsaved");
        });
    };

    // Push the current document to the server NOW: bump the shared version and
    // cancel the pending debounced didChange. Completion/hover call this so they
    // query the server's up-to-date copy instead of racing the 300ms debounce.
    // Awaiting didChange before the request keeps them ordered over the stdio
    // connection, so the server sees the new text first.
    const syncLspNow = async (): Promise<void> => {
      if (!lspLang) return;
      if (lspTimer) {
        clearTimeout(lspTimer);
        lspTimer = undefined;
      }
      lspVersion += 1;
      await window.airlock.lspDidChange(
        root,
        relPath,
        lspVersion,
        view.state.doc.toString(),
      );
    };

    const view = new EditorView({
      state: EditorState.create({
        doc: file.content,
        extensions: [
          basicSetup,
          ...(theme === "dark" ? [oneDark] : []),
          EditorView.theme({ "&": { height: "100%" } }),
          lintGutter(),
          ...(lspLang
            ? [
                autocompletion({
                  override: [
                    makeLspCompletionSource(root, relPath, syncLspNow),
                  ],
                }),
                makeLspHover(root, relPath, syncLspNow),
                EditorView.domEventHandlers({
                  mousedown(event, view) {
                    if (!event.metaKey) return false;
                    const pos = view.posAtCoords({
                      x: event.clientX,
                      y: event.clientY,
                    });
                    if (pos == null) return false;
                    event.preventDefault(); // suppress cursor/selection on this click
                    void goToDefinition(
                      root,
                      relPath,
                      tabId,
                      syncLspNow,
                      view.state.doc.toString(),
                      pos,
                    );
                    return true;
                  },
                }),
              ]
            : []),
          ...languageExtensionForPath(relPath),
          ...(editable
            ? [
                EditorView.updateListener.of((u) => {
                  if (!u.docChanged) return;
                  dirty = true;
                  setSaveState("unsaved");
                  if (timer) clearTimeout(timer);
                  timer = setTimeout(flush, AUTOSAVE_MS);
                  if (lspLang) {
                    if (lspTimer) clearTimeout(lspTimer);
                    lspTimer = setTimeout(() => {
                      lspVersion += 1;
                      void window.airlock.lspDidChange(
                        root,
                        relPath,
                        lspVersion,
                        view.state.doc.toString(),
                      );
                    }, LSP_DEBOUNCE_MS);
                  }
                }),
                keymap.of([
                  {
                    key: "Mod-s", // force-save now (autosave still runs on its own)
                    preventDefault: true,
                    run: () => {
                      flush();
                      return true;
                    },
                  },
                ]),
              ]
            : [EditorState.readOnly.of(true), EditorView.editable.of(false)]),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    if (lspLang) {
      void window.airlock.lspDidOpen(
        root,
        relPath,
        lspLang,
        lspVersion,
        file.content,
      );
    }

    return () => {
      flush(); // flush before the editor goes away (file switch / unmount)
      if (lspTimer) clearTimeout(lspTimer);
      if (lspLang) void window.airlock.lspDidClose(root, relPath);
      view.destroy();
      viewRef.current = null;
    };
  }, [root, relPath, file, theme, editable, lspLang]);

  // When a caller (e.g. search) reveals this file in this pane, scroll + select
  // to the line. The nonce in `reveal` is in the deps so repeated reveals of the
  // same line retrigger; the line is clamped to the document.
  useEffect(() => {
    if (!reveal || reveal.tabId !== tabId || reveal.path !== relPath) return;
    const view = viewRef.current;
    if (!view) return;
    const lineNo = Math.max(1, Math.min(reveal.line, view.state.doc.lines));
    const pos = view.state.doc.line(lineNo).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }, [reveal, tabId, relPath]);

  // Render diagnostics pushed by the language server for THIS file.
  useEffect(() => {
    if (!lspLang) return;
    return window.airlock.onLspDiagnostics((e) => {
      if (e.root !== root || e.relPath !== relPath) return;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch(
        setDiagnostics(
          view.state,
          toCmDiagnostics(view.state.doc.toString(), e.diagnostics),
        ),
      );
    });
  }, [lspLang, root, relPath]);

  return (
    <div className="editor-pane">
      <div className="editor-status" aria-live="polite">
        {!editable ? (
          <span className="badge">too large to edit (first 1 MB)</span>
        ) : saveState === "unsaved" ? (
          <span className="editor-dot" title="Unsaved - autosaving">
            unsaved
          </span>
        ) : saveState === "saved" ? (
          <span className="editor-saved">saved</span>
        ) : null}
      </div>
      <div ref={hostRef} className="viewer-host" />
    </div>
  );
}
