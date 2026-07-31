import { useEffect, useState } from "react";
import type { AgentRequest } from "../../../shared/agentRequests";

// Subscribe to THIS window's agent requests. Main owns the registry and pushes
// each window its own projection, so this hook holds a view and never the source
// of truth -- which is what lets a renderer reload, a window close or a project
// tear-off happen without stranding a waiting agent.
//
// The snapshot-on-mount is the half that survives a reload: the push alone would
// leave a freshly reloaded renderer blank until the next change.
export function useAgentRequests(): AgentRequest[] {
  const [requests, setRequests] = useState<AgentRequest[]>([]);

  useEffect(() => {
    let live = true;
    void window.airlock.agentRequestsList().then((r) => {
      if (live) setRequests(r);
    });
    const off = window.airlock.onAgentRequests((r) => {
      if (live) setRequests(r);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  return requests;
}
