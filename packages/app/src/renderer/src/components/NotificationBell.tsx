import { useState } from "react";
import { bellCount, partitionRequests } from "../../../shared/agentRequests";
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
  // Count what you can still DO something about. An expired terminal grant is
  // pruned in main and never reaches here; an expired secret request does, and
  // stays actionable because vaulting it is still useful.
  const count = bellCount(bell);

  return (
    <div className="titlebar-bell">
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
        <div className="titlebar-bell-panel">
          {bell.length === 0 ? (
            <div className="agent-request-note">No notifications yet.</div>
          ) : (
            bell.map((r) => (
              // Not dismissible from here: it is already dismissed, so a second
              // "Later" would do nothing.
              <AgentRequestCard
                key={r.requestId}
                request={r}
                dismissible={false}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
