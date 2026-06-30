import { useEffect, useState } from "react";

type State =
  | { kind: "loading" }
  | { kind: "ok"; dataUrl: string }
  | { kind: "too-large" }
  | { kind: "error" };

// Inline PDF preview via Chromium's built-in viewer (needs webPreferences.plugins
// + a CSP that allows the data: source). Falls back to Open-externally when the
// PDF is too large to inline or fails to load.
export function PdfViewer({
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
      .readPdfDataUrl(root, relPath)
      .then((r) => {
        if (cancelled) return;
        setState(
          r.tooLarge
            ? { kind: "too-large" }
            : { kind: "ok", dataUrl: r.dataUrl },
        );
      })
      .catch((err) => {
        console.error("readPdfDataUrl failed", err);
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [root, relPath]);

  if (state.kind === "loading")
    return <div className="viewer-host empty">loading…</div>;
  if (state.kind === "ok")
    return (
      <div className="pdf-preview-host">
        <embed
          className="pdf-preview"
          type="application/pdf"
          src={state.dataUrl}
        />
      </div>
    );
  return (
    <div className="binary-notice">
      <div>
        {state.kind === "too-large"
          ? "PDF too large to preview."
          : "Could not preview this PDF."}
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => void window.airlock.openExternalFile(root, relPath)}
      >
        Open externally
      </button>
    </div>
  );
}
