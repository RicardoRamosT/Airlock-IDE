// packages/app/src/renderer/src/lib/pixelRatio.ts
// Notice when the display's pixel ratio changes: window dragged to a
// differently-scaled screen, a resolution switch, a monitor attached on wake.
//
// Nothing resizes on such a change -- element boxes keep their CSS sizes -- so a
// ResizeObserver never fires, while anything measured in RENDERED pixels (xterm's
// cell height, and so a terminal's row count) is now wrong.
//
// The subtlety this exists for: `(resolution: Xdppx)` matches ONE ratio, so a
// listener armed once goes permanently unmatched after the first change and
// misses every later one (verified against Chromium: an un-re-armed query fired
// on 2 -> 2.5 and then stayed silent through 3 and 4). It has to be re-armed at
// the new ratio each time.

/**
 * Calls `onChange` after every pixel-ratio change. Returns a disposer.
 * A no-op where matchMedia is absent (jsdom), which costs the tests nothing.
 */
export function onPixelRatioChange(onChange: () => void): () => void {
  let query: MediaQueryList | null = null;
  const handler = () => {
    arm(); // re-arm FIRST, so a change during onChange is not missed
    onChange();
  };
  const arm = (): void => {
    query?.removeEventListener("change", handler);
    query =
      window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`) ??
      null;
    query?.addEventListener("change", handler);
  };
  arm();
  return () => {
    query?.removeEventListener("change", handler);
    query = null;
  };
}
