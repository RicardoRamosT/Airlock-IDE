import { beforeEach, describe, expect, it } from "vitest";
import type { AgentRequest } from "../shared/agentRequests";
import {
  AGENT_REQUEST_POLICY,
  partitionRequests,
  REGISTRY_MAX,
} from "../shared/agentRequests";
import {
  __resetAgentRequests,
  dismissAgentRequest,
  type LongRunningAppInput,
  listRequestsForWindow,
  longRunningNotices,
  reconcileLongRunningApps,
  requestSecretFromUser,
  setRequestHost,
} from "./agent-requests";

function fakeHost(live: number[] = [1]) {
  const h = {
    live,
    sent: [] as { windowId: number; requests: AgentRequest[] }[],
    windowIds: () => h.live,
    pickWindow: () => h.live[0] ?? null,
    send: (windowId: number, requests: AgentRequest[]) => {
      h.sent.push({ windowId, requests });
    },
  };
  return h;
}

const STARTED = 1_700_000_000_000;

function app(over: Partial<LongRunningAppInput> = {}): LongRunningAppInput {
  return {
    appType: "container",
    appId: "c1",
    name: "trackview-postgres-1",
    detail: "postgres:17",
    startedAt: STARTED,
    root: "/p/Trackview",
    projectName: "trackview",
    ...over,
  };
}

beforeEach(() => {
  __resetAgentRequests();
  setRequestHost(fakeHost());
});

describe("reconcileLongRunningApps", () => {
  it("raises a notice for each over-threshold app", () => {
    reconcileLongRunningApps([app(), app({ appId: "c2", name: "other" })]);
    expect(
      longRunningNotices()
        .map((n) => n.appId)
        .sort(),
    ).toEqual(["c1", "c2"]);
  });

  it("retires a notice when its app stops", () => {
    reconcileLongRunningApps([app()]);
    reconcileLongRunningApps([]);
    expect(longRunningNotices()).toEqual([]);
  });

  it("does not duplicate or churn a notice across polls", () => {
    reconcileLongRunningApps([app()]);
    const first = longRunningNotices()[0];
    reconcileLongRunningApps([app()]);
    reconcileLongRunningApps([app()]);
    const after = longRunningNotices();
    expect(after).toHaveLength(1);
    // Same entry, not a recreated one -- otherwise the card would jump to the
    // top of the bell every ten minutes.
    expect(after[0]?.requestId).toBe(first?.requestId);
  });
});

describe("acknowledging", () => {
  it("dismiss removes the notice AND stops it coming back", () => {
    reconcileLongRunningApps([app()]);
    const id = longRunningNotices()[0]?.requestId ?? "";
    dismissAgentRequest(id);
    expect(longRunningNotices()).toEqual([]);
    reconcileLongRunningApps([app()]); // the app is still running
    expect(longRunningNotices()).toEqual([]);
  });

  it("reports the app again once it is RESTARTED", () => {
    // Identity includes startedAt, so a restart is a new identity. Without
    // that, acknowledging once would silence this container forever.
    reconcileLongRunningApps([app()]);
    dismissAgentRequest(longRunningNotices()[0]?.requestId ?? "");
    reconcileLongRunningApps([app({ startedAt: STARTED + 1_000 })]);
    expect(longRunningNotices()).toHaveLength(1);
  });
});

describe("surface", () => {
  it("is born in the bell and never takes a corner slot", () => {
    reconcileLongRunningApps([app()]);
    const { stack, bell } = partitionRequests(listRequestsForWindow(1));
    expect(stack).toEqual([]);
    expect(bell).toHaveLength(1);
    expect(AGENT_REQUEST_POLICY.longRunningApp.surface).toBe("bell");
  });
});

describe("registry cap", () => {
  it("evicts waiter-less notices rather than stranding a pending request", () => {
    // The cap rule used to protect anything "pending". A notice is pending for
    // as long as its app runs, so under that rule enough notices would pin the
    // registry and starve real requests -- while stranding nobody.
    void requestSecretFromUser("NEEDED", undefined, "/a");
    const many: LongRunningAppInput[] = [];
    for (let i = 0; i < REGISTRY_MAX + 20; i++)
      many.push(app({ appId: `c${i}` }));
    reconcileLongRunningApps(many);

    const all = listRequestsForWindow(1);
    expect(all.length).toBeLessThanOrEqual(REGISTRY_MAX);
    // The agent is still waiting on this one, so it must survive.
    expect(all.some((r) => r.kind === "secret" && r.name === "NEEDED")).toBe(
      true,
    );
  });
});
