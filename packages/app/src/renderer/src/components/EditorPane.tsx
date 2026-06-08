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
import type { FileContent } from "../../../shared/ipc";
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

// LSP completion + hover for one open file. The sources close over the pane's
// root/relPath and call the IPC at the cursor position (offset -> LSP position).
function lspExtensions(root: string, relPath: string): Extension[] {
  const completion: CompletionSource = async (context) => {
    const word = context.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const { line, character } = positionAt(
      context.state.doc.toString(),
      context.pos,
    );
    const items = await window.airlock.lspCompletion(
      root,
      relPath,
      line,
      character,
    );
    if (items.length === 0) return null;
    return {
      from: word.from,
      options: toCmCompletions(items),
      validFor: /[\w$]*/,
    };
  };
  const hover = hoverTooltip(async (view, pos) => {
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
  return [autocompletion({ override: [completion] }), hover];
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

    const view = new EditorView({
      state: EditorState.create({
        doc: file.content,
        extensions: [
          basicSetup,
          ...(theme === "dark" ? [oneDark] : []),
          EditorView.theme({ "&": { height: "100%" } }),
          lintGutter(),
          ...(lspLang ? lspExtensions(root, relPath) : []),
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
