import { useEffect, useMemo, useState } from "react";
import type { DocumentData } from "../../../shared/ipc"; // import type only
import { docxHtmlToReact } from "../lib/docxHtml";

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: DocumentData }
  | { kind: "too-large" }
  | { kind: "error" };

export function DocxViewer({
  root,
  relPath,
}: {
  root: string;
  relPath: string;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    window.airlock
      .readDocument(root, relPath)
      .then((d) => {
        if (cancelled) return;
        setState(d.tooLarge ? { kind: "too-large" } : { kind: "ok", data: d });
      })
      .catch((err) => {
        console.error("readDocument failed", err);
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [root, relPath]);

  // Parsing the HTML is the expensive part of a long document; a re-render for
  // an unrelated reason must not redo it.
  const body = useMemo(
    () => (state.kind === "ok" ? docxHtmlToReact(state.data.html) : null),
    [state],
  );

  if (state.kind === "loading")
    return <div className="viewer-host empty">loading…</div>;
  if (state.kind === "too-large")
    return (
      <div className="viewer-host empty">
        This document is too large to preview here.
      </div>
    );
  if (state.kind === "error")
    return (
      <div className="viewer-host empty">Could not read this document.</div>
    );

  const empty = !body || body.length === 0;
  return (
    <div className="viewer-host docx-viewer-host">
      <article className="docx-page">
        {empty ? (
          <p className="docx-empty">This document has no readable text.</p>
        ) : (
          body
        )}
        {/* Say what could not be shown rather than quietly rendering a
            document that is missing pieces. */}
        {state.data.notes.length > 0 && (
          <details className="docx-notes">
            <summary>
              {state.data.notes.length} part
              {state.data.notes.length === 1 ? "" : "s"} of this document could
              not be converted
            </summary>
            <ul>
              {state.data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}
      </article>
    </div>
  );
}
