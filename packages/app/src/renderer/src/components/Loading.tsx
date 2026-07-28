import { useEffect, useState } from "react";

// The app's ONE loading state. Before this there were five spellings of it
// (`loading…`, `Loading…`, `loading...`, `Checking…`, `loading deploys…`), all
// static text, none animated -- and, worse, most fetching surfaces had no
// loading state at all: they initialised to `[]` and painted an EMPTY RESULT
// as if it were the answer while an 8s CLI probe ran. That is what read as the
// app being frozen. See the 2026-07-27 loading-states design.
//
// Using it is half the fix. The other half is at each call site: initial state
// must be `null` ("not asked yet"), distinct from an empty array ("asked, and
// the answer is nothing"), and a POLL must never send a surface back to
// loading -- these poll every 5s, so that would flash a spinner forever.

// How long a fetch may take before it is worth telling the user about. A
// spinner that appears and vanishes inside 80ms reads as a glitch rather than
// as progress, and the warm-cache path on most of these surfaces is single-
// digit milliseconds. Exported so tests advance by exactly this rather than
// hardcoding a number that could drift away from the component.
export const LOADING_DELAY_MS = 150;

export function Loading({
  label,
  size = "section",
}: {
  // Names what is loading, for screen readers -- e.g. "Loading extensions".
  // Required: this is usually the ONLY thing on screen while it shows, and a
  // bare spinning glyph announces nothing at all.
  label: string;
  // "page" reserves more height than "section". Both reserve SOME, so a pane
  // does not collapse to spinner-height and then jerk open when content lands.
  size?: "section" | "page";
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), LOADING_DELAY_MS);
    // These mount and unmount on every sidebar view switch, so a timer left
    // running would fire setState on a dead component.
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  return (
    <div
      className={`loading${size === "page" ? " page" : ""}`}
      role="status"
      aria-label={label}
    >
      {/* Decorative: the container above carries the role and the name. The
          animation is CSS-only, so prefers-reduced-motion can stop the spin
          without this element (and therefore the state) disappearing. */}
      <span className="loading-spinner" aria-hidden="true" />
    </div>
  );
}
