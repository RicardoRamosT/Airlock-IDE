import { useEffect, useState } from "react";
import type { AgentRequest } from "../../../shared/agentRequests";

// Subscribe to THIS window's agent requests. Main owns the registry and pushes
// each window its own projection, so this hook holds a view and never the source
// of truth -- which is what lets a renderer reload, a window close or a project
// tear-off happen without stranding a waiting agent.
//
// The snapshot-on-mount is the half that survives a reload: the push alone would
// leave a freshly reloaded renderer blank until the next change.
// Anything that is not an array becomes an empty list. This is the boundary
// where main's payload enters the renderer, and the stack renders inside the App
// tree: a malformed payload that threw during render would take the WHOLE window
// white, not just the cards. Caught by the App smoke test (the white-screen
// guard) when its IPC stub returned a non-array.
function asRequests(r: unknown): AgentRequest[] {
  return Array.isArray(r) ? (r as AgentRequest[]) : [];
}

export function useAgentRequests(): AgentRequest[] {
  const [requests, setRequests] = useState<AgentRequest[]>([]);

  useEffect(() => {
    let live = true;
    void Promise.resolve(window.airlock.agentRequestsList())
      .then((r) => {
        if (live) setRequests(asRequests(r));
      })
      .catch(() => {
        if (live) setRequests([]);
      });
    const off = window.airlock.onAgentRequests((r) => {
      if (live) setRequests(asRequests(r));
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  return requests;
}
