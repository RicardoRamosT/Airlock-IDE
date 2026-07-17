import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import type { Scope } from "../lib/editorScopes";
import { stickyLines } from "../lib/editorSticky";

// VS Code-style sticky scroll: pinned enclosing-scope header lines at the top
// of the editor. Reads the top visible line on scroll (rAF-throttled), asks
// stickyLines (Task 8) which enclosing scopes are pinned, and renders their
// head-line TEXT as clickable rows. Click scrolls that scope to the top of
// the view; wheel forwards deltaY to the editor's own scroller so scrolling
// through the overlay works like scrolling the code beneath it. Renders null
// when there's no live view yet or nothing is pinned. Presentation-only --
// EditorPane owns the `scopes` model and the live EditorView.
export function StickyScroll({
  view,
  scopes,
}: {
  view: EditorView | null;
  scopes: Scope[];
}) {
  const [pinned, setPinned] = useState<{ scope: Scope; text: string }[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!view) return;
    const recompute = () => {
      rafRef.current = null;
      // lineBlockAtHeight interprets its argument relative to the top of the
      // document (same coordinate space as scrollDOM.scrollTop), so this
      // finds the block currently at the top of the viewport.
      const topPos = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
      const topLine = view.state.doc.lineAt(topPos).number;
      const rows = stickyLines(scopes, topLine).map((scope) => {
        // Defensive clamp: scopes can briefly reference a line beyond the
        // current document right after an edit shrinks it, before the
        // debounced scope refetch catches up (see EditorPane's scopeNonce).
        const line = Math.min(scope.line, view.state.doc.lines);
        return { scope, text: view.state.doc.line(line).text };
      });
      setPinned(rows);
    };
    const onScroll = () => {
      if (rafRef.current == null)
        rafRef.current = requestAnimationFrame(recompute);
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    recompute();
    return () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [view, scopes]);

  if (!view || pinned.length === 0) return null;
  return (
    <div
      className="sticky-scroll"
      onWheel={(e) => {
        view.scrollDOM.scrollTop += e.deltaY; // forward wheel to the editor
      }}
    >
      {pinned.map(({ scope, text }) => (
        <button
          type="button"
          className="sticky-row"
          key={`${scope.line}-${scope.name}`}
          onClick={() => {
            const line = Math.min(scope.line, view.state.doc.lines);
            const pos = view.state.doc.line(line).from;
            view.dispatch({
              selection: { anchor: pos },
              effects: EditorView.scrollIntoView(pos, { y: "start" }),
            });
            view.focus();
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
