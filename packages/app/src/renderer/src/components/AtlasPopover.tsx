import { useEffect, useState } from "react";

// The popover is READ-ONLY in this plan: it shows today's brief. Conversation,
// the facts store and the authority model are Plan 3.
export function AtlasPopover() {
  const [brief, setBrief] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let alive = true;
    window.airlock
      ?.atlasBrief()
      .then((text) => {
        if (!alive) return;
        setBrief(text);
        setAsked(true);
      })
      .catch(() => {
        if (alive) setAsked(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Three states, not two: not-asked-yet is loading, asked-and-null is
  // genuinely no brief. Conflating them paints a finished-looking empty page
  // while a fetch is still running.
  if (!asked) return <div className="atlas-popover">Loading...</div>;

  return (
    <div className="atlas-popover">
      <h1>Atlas</h1>
      <button type="button" onClick={() => window.airlock?.atlasOpenWindow()}>
        Open Atlas
      </button>
      {brief === null ? (
        <p>No debrief yet. It writes itself the first time you arrive.</p>
      ) : (
        <pre>{brief}</pre>
      )}
    </div>
  );
}
