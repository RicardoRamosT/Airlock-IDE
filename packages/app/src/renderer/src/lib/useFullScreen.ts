import { useEffect } from "react";

// Mirror the window's fullscreen state onto the document root, where CSS can
// see it.
//
// A data attribute rather than store state on purpose: the ONLY consumer is a
// stylesheet rule that zeroes --app-radius, so putting it in the store would
// re-render the tree for something no component reads. The attribute is simply
// absent until main says otherwise, which is the not-fullscreen case anyway --
// so there is no first-paint flash to guess at.
export function useFullScreen(): void {
  useEffect(
    () =>
      window.airlock.onFullScreen((on) => {
        document.documentElement.dataset.fullscreen = on ? "true" : "false";
      }),
    [],
  );
}
