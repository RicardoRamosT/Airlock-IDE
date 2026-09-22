import { useEffect, useRef, useState } from "react";
import {
  AGENT_REQUEST_POLICY,
  bellCount,
  partitionRequests,
} from "../../../shared/agentRequests";
import { useAgentRequests } from "../lib/useAgentRequests";
import { AgentRequestCard } from "./AgentRequestStack";

// Dismissing a corner card means LATER, not gone -- it lands here so an accidental
// dismissal, or one made deliberately to deal with later, is recoverable.
//
// Mounted at the RIGHT END of the titlebar, deliberately outside TitleQuota's
// centering group: the title card must stay centred whether or not the usage
// meter is enabled.
//
// Built to hold more than agent requests later: entries carry a `kind` and the
// card renderer is chosen from it, so a future notification kind is a row in the
// policy table plus a renderer.
export function NotificationBell() {
  const requests = useAgentRequests();
  const { bell } = partitionRequests(requests);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // How far the panel must sit from its own right edge to clear the Atlas
  // panel, or null when Atlas is not in the way.
  const [avoidRight, setAvoidRight] = useState<number | null>(null);

  // MEASURED, never hardcoded. The two panels hang off different buttons, so
  // their right edges start at different insets, and Atlas is resizable -- any
  // constant offset here would be wrong the moment either changed. Measuring
  // the live element is exact and self-correcting.
  useEffect(() => {
    if (!open) {
      setAvoidRight(null);
      return;
    }
    const measure = () => {
      const atlas = document.querySelector<HTMLElement>(
        ".titlebar-atlas-panel",
      );
      const wrap = wrapRef.current;
      if (!atlas || !wrap) {
        setAvoidRight(null);
        return;
      }
      const a = atlas.getBoundingClientRect();
      if (a.width === 0) {
        setAvoidRight(null);
        return;
      }
      // `right` is measured from the wrapper's right edge, so this is the
      // distance that lands our right edge just left of Atlas.
      setAvoidRight(
        Math.max(
          0,
          Math.round(wrap.getBoundingClientRect().right - a.left + 10),
        ),
      );
    };
    measure();
    // Atlas can open, close or be resized while the bell is already open, so a
    // single measurement at open time is not enough. rAF because the panel is
    // mounted by the same commit that flips the attribute.
    const mo = new MutationObserver(() => requestAnimationFrame(measure));
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-atlas-open"],
    });
    window.addEventListener("resize", measure);
    return () => {
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);
  // Count what you can still DO something about. An expired terminal grant is
  // pruned in main and never reaches here; an expired secret request does, and
  // stays actionable because vaulting it is still useful.
  const count = bellCount(bell);

  return (
    <div className="titlebar-bell" ref={wrapRef}>
      <button
        type="button"
        className="titlebar-bell-btn"
        title={
          count > 0
            ? `${count} notification${count === 1 ? "" : "s"} waiting`
            : "No notifications"
        }
        aria-label={
          count > 0 ? `Notifications: ${count} waiting` : "Notifications: none"
        }
        onClick={() => setOpen((v) => !v)}
      >
        <i className="codicon codicon-bell" />
        {count > 0 && <span className="titlebar-bell-badge">{count}</span>}
      </button>
      {open && (
        <div
          className="titlebar-bell-panel"
          style={avoidRight === null ? undefined : { right: avoidRight }}
        >
          {bell.length === 0 ? (
            <div className="agent-request-note">No notifications yet.</div>
          ) : (
            bell.map((r) => (
              // A card that ARRIVED here by being dismissed offers no second
              // "Later" -- it would do nothing. A bell-surface kind was never
              // dismissed (this is where it is born), so for those "Later"
              // still means something: acknowledge it and stop being told.
              <AgentRequestCard
                key={r.requestId}
                request={r}
                dismissible={
                  AGENT_REQUEST_POLICY[r.kind].surface === "bell" &&
                  !r.dismissed
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
