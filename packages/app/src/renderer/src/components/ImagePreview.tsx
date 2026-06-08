import { useEffect, useState } from "react";

type State =
  | { kind: "loading" }
  | { kind: "ok"; dataUrl: string }
  | { kind: "too-large" }
  | { kind: "error" };

// Inline preview for a raster image. Fetches a data URL (own process, never
// decoded as text); falls back to an Open-externally action when the image is
// too large to inline or fails to load.
export function ImagePreview({
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
      .readImageDataUrl(root, relPath)
      .then((r) => {
        if (cancelled) return;
        setState(
          r.tooLarge
            ? { kind: "too-large" }
            : { kind: "ok", dataUrl: r.dataUrl },
        );
      })
      .catch((err) => {
        console.error("readImageDataUrl failed", err);
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
      <div className="image-preview-host">
        <img
          className="image-preview"
          src={state.dataUrl}
          alt={relPath}
          onError={() => setState({ kind: "error" })}
        />
      </div>
    );
  return (
    <div className="binary-notice">
      <div>
        {state.kind === "too-large"
          ? "Image too large to preview."
          : "Could not preview this image."}
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
