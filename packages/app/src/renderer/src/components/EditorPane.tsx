import {
  autocompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef, useState } from "react";
import type { FileContent, LspCompletionItem } from "../../../shared/ipc";
import { editorChrome } from "../lib/editorChrome";
import { openEditorFile } from "../lib/editorFiles";
import {
  enclosingScopes,
  lspSymbolsToScopes,
  pathSegments,
  type Scope,
  scopesFromMarkdown,
} from "../lib/editorScopes";
import { editorTheme } from "../lib/editorTheme";
import { languageExtensionForPath } from "../lib/language";
import { toCmCompletions } from "../lib/lspCompletions";
import { toCmDiagnostics } from "../lib/lspDiagnostics";
import { lspLanguageId } from "../lib/lspLanguage";
import { positionAt } from "../lib/lspPositions";
import { useApp } from "../store";
import { EditorBreadcrumb, type SaveState } from "./EditorBreadcrumb";
import { EditorContextMenu } from "./EditorContextMenu";
import { StickyScroll } from "./StickyScroll";

// Autosave: write the file this long after the last keystroke. A switch/unmount
// flushes immediately (the effect cleanup), so nothing is lost on navigation.
const AUTOSAVE_MS = 800;
// Debounce window for pushing full-text changes to the language server.
const LSP_DEBOUNCE_MS = 300;

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
  // Bumped right after viewRef.current is (re)assigned in the construction
  // effect below, purely to force a re-render -- refs alone don't trigger one.
  // StickyScroll is keyed on this so it remounts against the current
  // EditorView instance instead of a stale one.
  const [viewReady, setViewReady] = useState(0);
  const reveal = useApp((s) => s.reveal);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // Scope model (for the breadcrumb's symbol trail) + the cursor's current
  // line (for picking the enclosing chain out of it). Both are presentation
  // state only -- see the scopes-fetch effect and updateListener below.
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [cursorLine, setCursorLine] = useState(1);
  // Bumped (debounced) on doc changes to retrigger the scope-fetch effect --
  // see the updateListener below and the scope-fetch effect's dependency array.
  const [scopeNonce, setScopeNonce] = useState(0);
  const setReferences = useApp((s) => s.setReferences);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    line: number;
    character: number;
    pos: number;
    symbol: string;
  } | null>(null);
  // The effect rebuilds the EditorView; this ref lets the React-rendered menu
  // call the same doc-flush the in-editor handlers use.
  const syncRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const editable = !file.truncated;
  const lspLang = lspLanguageId(relPath);
  const isMarkdown = /\.mdx?$/i.test(relPath);
  // Theme lives in a CodeMirror Compartment so a theme toggle RECONFIGURES it in
  // place (separate effect below) instead of being a dependency of the editor-
  // construction effect. Rebuilding the editor on a theme change recreated the
  // EditorState from the (stale) file.content prop, discarding the live buffer's
  // unsaved edits -- and the next autosave then overwrote disk with the reverted
  // text. (audit PB-H1)
  const themeCompartment = useRef(new Compartment()).current;
  // Read the current theme at construction time without making `theme` a dep of
  // the construction effect (which would reintroduce the rebuild).
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setSaveState("idle");

    let timer: ReturnType<typeof setTimeout> | undefined;
    let lspTimer: ReturnType<typeof setTimeout> | undefined;
    let scopeTimer: ReturnType<typeof setTimeout> | undefined;
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
    syncRef.current = syncLspNow;

    const view = new EditorView({
      state: EditorState.create({
        doc: file.content,
        extensions: [
          basicSetup,
          themeCompartment.of(editorTheme(themeRef.current)),
          EditorView.theme({ "&": { height: "100%" } }),
          ...editorChrome(),
          // Track the cursor's line for the breadcrumb's symbol trail.
          // Unconditional (not gated on `editable`): a read-only/truncated
          // view still allows moving the selection, and the breadcrumb should
          // track it there too.
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) {
              const line = u.state.doc.lineAt(
                u.state.selection.main.head,
              ).number;
              setCursorLine(line);
            }
            if (u.docChanged) {
              if (scopeTimer) clearTimeout(scopeTimer);
              scopeTimer = setTimeout(() => setScopeNonce((n) => n + 1), 600);
            }
          }),
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
                  contextmenu(event, view) {
                    const p = view.posAtCoords({
                      x: event.clientX,
                      y: event.clientY,
                    });
                    if (p == null) return false;
                    event.preventDefault();
                    const { line, character } = positionAt(
                      view.state.doc.toString(),
                      p,
                    );
                    const w = view.state.wordAt(p);
                    setMenu({
                      x: event.clientX,
                      y: event.clientY,
                      line,
                      character,
                      pos: p,
                      symbol: w ? view.state.sliceDoc(w.from, w.to) : "",
                    });
                    return true;
                  },
                }),
                keymap.of([
                  {
                    key: "Shift-F12",
                    preventDefault: true,
                    run: (v) => {
                      const p = v.state.selection.main.head;
                      const { line, character } = positionAt(
                        v.state.doc.toString(),
                        p,
                      );
                      const w = v.state.wordAt(p);
                      const symbol = w ? v.state.sliceDoc(w.from, w.to) : "";
                      void (async () => {
                        await syncLspNow();
                        try {
                          const refs = await window.airlock.lspReferences(
                            root,
                            relPath,
                            line,
                            character,
                          );
                          setReferences(symbol, refs);
                        } catch (err) {
                          console.error("[lsp] references failed", err);
                        }
                      })();
                      return true;
                    },
                  },
                ]),
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
    setViewReady((n) => n + 1);
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
      if (scopeTimer) clearTimeout(scopeTimer);
      if (lspLang) void window.airlock.lspDidClose(root, relPath);
      view.destroy();
      viewRef.current = null;
    };
    // NOTE: `theme` is deliberately NOT a dependency -- it is applied via the
    // compartment in the effect below so a toggle never rebuilds the editor.
  }, [
    root,
    relPath,
    file,
    editable,
    lspLang,
    tabId,
    themeCompartment,
    setReferences,
  ]);

  // Apply the theme by reconfiguring the compartment IN PLACE, preserving the
  // live document. Runs on mount too (harmless: the compartment was initialized
  // to the same theme), and on every theme toggle thereafter. (audit PB-H1)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(editorTheme(theme)),
    });
  }, [theme, themeCompartment]);

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

  // Fetch the scope model that feeds the breadcrumb's symbol trail: LSP
  // languages ask the language server for document symbols; markdown parses
  // the live buffer's headings; anything else has no scopes. Refreshes on
  // open/language change and on `scopeNonce`, which the construction effect's
  // updateListener bumps (debounced, 600ms) on every doc change -- so the
  // trail stays fresh after edits with zero idle polling. Cursor-only moves
  // don't bump the nonce; they're free via enclosingScopes on render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeNonce is not read in the body but intentionally included as a trigger dep — the construction effect's updateListener bumps it (debounced) on doc changes to force a refetch.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const view = viewRef.current;
      if (!view) return;
      if (lspLang) {
        try {
          const syms = await window.airlock.lspDocumentSymbol(root, relPath);
          if (!cancelled) setScopes(lspSymbolsToScopes(syms));
        } catch {
          if (!cancelled) setScopes([]);
        }
      } else if (isMarkdown) {
        if (!cancelled)
          setScopes(scopesFromMarkdown(view.state.doc.toString()));
      } else if (!cancelled) {
        setScopes([]);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [root, relPath, lspLang, isMarkdown, scopeNonce]);

  return (
    <div className="editor-pane">
      <EditorBreadcrumb
        pathSegments={pathSegments(relPath)}
        symbolTrail={enclosingScopes(scopes, cursorLine)}
        saveState={saveState}
        truncated={!editable}
        onSymbolClick={(s) => {
          const view = viewRef.current;
          if (!view) return;
          const line = Math.max(1, Math.min(s.line, view.state.doc.lines));
          const pos = view.state.doc.line(line).from;
          view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
          view.focus();
        }}
      />
      <div ref={hostRef} className="viewer-host" />
      <StickyScroll
        // viewReady bumps when the view is (re)constructed so the overlay
        // binds to the current instance; scopes drive its pinned content.
        key={viewReady}
        view={viewRef.current}
        scopes={scopes}
      />
      {menu && (
        <EditorContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onDefinition={() => {
            const view = viewRef.current;
            if (view)
              void goToDefinition(
                root,
                relPath,
                tabId,
                syncRef.current,
                view.state.doc.toString(),
                menu.pos,
              );
            setMenu(null);
          }}
          onReferences={() => {
            const m = menu;
            setMenu(null);
            void (async () => {
              await syncRef.current();
              try {
                const refs = await window.airlock.lspReferences(
                  root,
                  relPath,
                  m.line,
                  m.character,
                );
                setReferences(m.symbol, refs);
              } catch (err) {
                console.error("[lsp] references failed", err);
              }
            })();
          }}
        />
      )}
    </div>
  );
}
