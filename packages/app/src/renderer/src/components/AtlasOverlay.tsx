import { useEffect, useRef } from "react";
import { AtlasPanel } from "./AtlasPanel";

// The Atlas conversation, hinged on the spine.
//
// It OVERLAYS: absolutely positioned inside the workspace row, so no pane
// resizes and no terminal reflows when it opens. That is not a preference --
// a surface that reflows the editor under you is a surface you learn not to
// open, and the spine exists to be opened casually.
//
// AtlasPanel is reused WHOLE, in its HOSTED mode -- deliberately NOT
// `standalone`. `standalone` means "I am a whole window": it draws
// .atlas-titlebar, which carries `-webkit-app-region: drag` and 78px of
// traffic-light padding. Inside an overlay that drag region SWALLOWS every
// click on the Debrief/Chat/... buttons, which is exactly how this shipped
// unclickable. Hosted mode draws .atlas-popover-head instead: no drag, no
// padding for window controls.
//
// `focusRoot` is what makes this the PROJECT's chat rather than the portfolio
// one. Without it, opening from a dot and asking "what is left here?" gets
// answered about everything.
export function AtlasOverlay({
  root,
  onClose,
}: {
  // null = the portfolio-wide chat, opened from the titlebar mark.
  root: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Escape closes. Registered only while the overlay is open, so nothing
  // global is captured the rest of the time -- the agent-request cards learned
  // the same lesson about not seizing Escape from the whole window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Clicking your work closes it. This is a casual surface hinged on a strip
  // you glance at; having to aim at a close button to get back to the terminal
  // is the friction that makes a panel one you stop opening.
  //
  // THE OPENERS ARE EXCLUDED, and that is not politeness -- it is required.
  // The spine dot and the titlebar mark are TOGGLES: mousedown fires before
  // click, so closing here would leave their own click to re-open the overlay
  // a moment later, and a second click on the open project's dot would never
  // close anything.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (ref.current?.contains(t)) return;
      if (t.closest(".atlas-spine, .titlebar-atlas")) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div className="atlas-overlay" ref={ref}>
      <AtlasPanel focusRoot={root} />
    </div>
  );
}
