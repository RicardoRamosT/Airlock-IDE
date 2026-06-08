import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef, useState } from "react";
import type { FileContent } from "../../../shared/ipc";
import { languageExtensionForPath } from "../lib/language";

// Autosave: write the file this long after the last keystroke. A switch/unmount
// flushes immediately (the effect cleanup), so nothing is lost on navigation.
const AUTOSAVE_MS = 800;
type SaveState = "idle" | "unsaved" | "saved";

// Editable CodeMirror with debounced autosave. One instance per open file
// (keyed by the caller on the path), so switching files remounts this and the
// cleanup flushes the outgoing file. A TRUNCATED file (read cap exceeded) is
// shown read-only -- saving a prefix would destroy the rest on disk.
export function EditorPane({
  root,
  relPath,
  file,
  theme,
}: {
  root: string;
  relPath: string;
  file: FileContent;
  theme: "dark" | "light";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const editable = !file.truncated;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setSaveState("idle");

    let timer: ReturnType<typeof setTimeout> | undefined;
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
          ...languageExtensionForPath(relPath),
          ...(editable
            ? [
                EditorView.updateListener.of((u) => {
                  if (!u.docChanged) return;
                  dirty = true;
                  setSaveState("unsaved");
                  if (timer) clearTimeout(timer);
                  timer = setTimeout(flush, AUTOSAVE_MS);
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

    return () => {
      flush(); // flush before the editor goes away (file switch / unmount)
      view.destroy();
    };
  }, [root, relPath, file, theme, editable]);

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
