import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRequest, SecretRequest } from "../shared/agentRequests";
import { REGISTRY_MAX } from "../shared/agentRequests";
import {
  __resetAgentRequests,
  dismissAgentRequest,
  gatedTerminalInput,
  listRequestsForWindow,
  pruneRequestsOnPtyExit,
  requestSecretFromUser,
  requestTerminalGrant,
  rerouteRequestsFromClosedWindow,
  resolveExternallyVaulted,
  resolveSecretRequest,
  resolveTerminalGrant,
  setRequestHost,
} from "./agent-requests";

// Electron is never touched: the registry reaches windows only through this seam,
// which is the whole point of the RequestHost DI boundary.
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

const names = (windowId = 1) =>
  listRequestsForWindow(windowId)
    .filter((r): r is SecretRequest => r.kind === "secret")
    .map((r) => r.name)
    .sort();

beforeEach(() => {
  __resetAgentRequests();
  setRequestHost(fakeHost());
});

describe("queueing", () => {
  it("allows several concurrent requests instead of refusing the second", () => {
    // The old single-modal-slot design returned {busy:true} here. A non-blocking
    // corner stack can hold several, so refusing would be incoherent.
    void requestSecretFromUser("A", undefined, "/a");
    void requestSecretFromUser("B", undefined, "/a");
    expect(names()).toEqual(["A", "B"]);
  });

  it("lets a secret request and a terminal grant coexist", () => {
    void requestSecretFromUser("A", undefined, "/a");
    void requestTerminalGrant("p1", "proj", "ls");
    expect(listRequestsForWindow(1)).toHaveLength(2);
  });

  it("resolves not-vaulted immediately when there is no window to ask", async () => {
    setRequestHost(fakeHost([]));
    expect(await requestSecretFromUser("A", undefined, "/a")).toEqual({
      vaulted: false,
    });
    expect(listRequestsForWindow(1)).toHaveLength(0);
  });
});

describe("coalescing", () => {
  it("shows one card for the same root and name and resolves BOTH waiters", async () => {
    const p1 = requestSecretFromUser("DB", undefined, "/a");
    const p2 = requestSecretFromUser("DB", undefined, "/a");
    const all = listRequestsForWindow(1);
    expect(all).toHaveLength(1);
    resolveSecretRequest(all[0]?.requestId ?? "", true);
    expect(await p1).toEqual({ vaulted: true });
    expect(await p2).toEqual({ vaulted: true });
  });

  it("does not coalesce different names, or the same name in another project", () => {
    void requestSecretFromUser("DB", undefined, "/a");
    void requestSecretFromUser("OTHER", undefined, "/a");
    void requestSecretFromUser("DB", undefined, "/b");
    expect(listRequestsForWindow(1)).toHaveLength(3);
  });

  it("never coalesces terminal grants", () => {
    void requestTerminalGrant("p1", "proj", "ls");
    void requestTerminalGrant("p2", "proj", "ls");
    expect(listRequestsForWindow(1)).toHaveLength(2);
  });
});

describe("expiry", () => {
  it("keeps an expired secret request visible but prunes an expired grant", async () => {
    vi.useFakeTimers();
    const secret = requestSecretFromUser("DB", undefined, "/a");
    const grant = requestTerminalGrant("p1", "proj", "ls");
    vi.advanceTimersByTime(5 * 60 * 1000 + 10);
    expect(await secret).toEqual({ vaulted: false, timedOut: true });
    expect(await grant).toEqual({ granted: false, timedOut: true });
    const left = listRequestsForWindow(1);
    expect(left).toHaveLength(1);
    expect(left[0]?.kind).toBe("secret");
    expect(left[0]?.state).toBe("expired");
    vi.useRealTimers();
  });
});

describe("dismiss", () => {
  it("moves the card to the bell WITHOUT resolving the agent", async () => {
    let settled = false;
    void requestSecretFromUser("DB", undefined, "/a").then(() => {
      settled = true;
    });
    const id = listRequestsForWindow(1)[0]?.requestId ?? "";
    dismissAgentRequest(id);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(listRequestsForWindow(1)[0]?.dismissed).toBe(true);
  });
});

describe("lifecycle pruning", () => {
  it("prunes a pending grant when its pty exits", async () => {
    const p = requestTerminalGrant("p1", "proj", "ls");
    pruneRequestsOnPtyExit("p1");
    expect(await p).toEqual({ granted: false });
    expect(listRequestsForWindow(1)).toHaveLength(0);
  });

  it("leaves a secret request alone on a pty exit", () => {
    void requestSecretFromUser("DB", undefined, "/a");
    pruneRequestsOnPtyExit("p1");
    expect(listRequestsForWindow(1)).toHaveLength(1);
  });

  it("resolves a matching request when the user vaults the secret by hand", async () => {
    const p = requestSecretFromUser("DB", undefined, "/a");
    resolveExternallyVaulted("/a", "DB");
    expect(await p).toEqual({ vaulted: true });
    expect(listRequestsForWindow(1)).toHaveLength(0);
  });

  it("ignores an unrelated external vault write", () => {
    void requestSecretFromUser("DB", undefined, "/a");
    resolveExternallyVaulted("/a", "SOMETHING_ELSE");
    resolveExternallyVaulted("/other", "DB");
    expect(listRequestsForWindow(1)).toHaveLength(1);
  });
});

describe("window lifecycle", () => {
  it("re-routes to a surviving window when the target window closes", () => {
    const host = fakeHost([1, 2]);
    setRequestHost(host);
    void requestSecretFromUser("DB", undefined, "/a"); // targets 1
    host.live = [2];
    rerouteRequestsFromClosedWindow(1);
    expect(listRequestsForWindow(2)).toHaveLength(1);
    expect(listRequestsForWindow(1)).toHaveLength(0);
  });

  it("resolves everything immediately when the LAST window closes", async () => {
    const host = fakeHost([1]);
    setRequestHost(host);
    const p = requestSecretFromUser("DB", undefined, "/a");
    host.live = [];
    rerouteRequestsFromClosedWindow(1);
    // Nothing left to ask -- do not hang to the timeout with nothing on screen.
    expect(await p).toEqual({ vaulted: false });
    expect(listRequestsForWindow(1)).toHaveLength(0);
  });

  it("pushes each window only its OWN requests", () => {
    const host = fakeHost([1]);
    setRequestHost(host);
    void requestSecretFromUser("DB", undefined, "/a");
    const last = host.sent.at(-1);
    expect(last?.windowId).toBe(1);
    expect(last?.requests).toHaveLength(1);
  });
});

describe("registry cap", () => {
  it("never evicts a pending entry under a flood", () => {
    void requestSecretFromUser("KEEP", undefined, "/a");
    for (let i = 0; i < REGISTRY_MAX + 10; i++) {
      void requestTerminalGrant(`p${i}`, "proj", "ls");
      const g = listRequestsForWindow(1).find(
        (r) => r.kind === "terminalGrant",
      );
      if (g) resolveTerminalGrant(g.requestId, false);
    }
    expect(names()).toContain("KEEP");
  });
});

describe("resolve", () => {
  it("resolving the same requestId twice resolves the promise once", async () => {
    let count = 0;
    void requestSecretFromUser("DB", undefined, "/a").then(() => {
      count++;
    });
    const id = listRequestsForWindow(1)[0]?.requestId ?? "";
    resolveSecretRequest(id, true);
    resolveSecretRequest(id, true);
    await Promise.resolve();
    expect(count).toBe(1);
  });

  it("an unknown requestId is a no-op", () => {
    expect(() => resolveSecretRequest("nope", true)).not.toThrow();
  });
});

// Lets the awaited askFirst settle so the approval card has been raised.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("gatedTerminalInput", () => {
  // askFirst: true throughout this block -- these cases are ABOUT the card, so
  // they opt into it explicitly rather than depending on the shipped default.
  const deps = (written: string[], askFirst = true) => ({
    write: (_id: string, data: string) => {
      written.push(data);
      return true;
    },
    label: () => "proj",
    askFirst: async () => askFirst,
  });

  it("errors when the pty id is unknown", async () => {
    const r = await gatedTerminalInput("gone", "hi", {
      write: () => true,
      label: () => null,
      askFirst: async () => true,
    });
    expect(r).toEqual({ error: "No such terminal (it may have closed)." });
  });

  it("writes once granted, and skips the card for an already-granted pty", async () => {
    const written: string[] = [];
    const d = deps(written);
    const first = gatedTerminalInput("p1", "hi\n", d);
    // askFirst is awaited before the card is raised, so it does not exist yet
    // in this synchronous turn.
    await tick();
    const id = listRequestsForWindow(1)[0]?.requestId ?? "";
    resolveTerminalGrant(id, true);
    expect(await first).toEqual({ sent: true });
    // Second send to the same pty must NOT open another card.
    const second = await gatedTerminalInput("p1", "again\n", d);
    expect(second).toEqual({ sent: true });
    expect(listRequestsForWindow(1)).toHaveLength(0);
    expect(written).toEqual(["hi\n", "again\n"]);
  });

  it("reports denied without writing", async () => {
    const written: string[] = [];
    const p = gatedTerminalInput("p9", "rm -rf /\n", deps(written));
    await tick();
    const id = listRequestsForWindow(1)[0]?.requestId ?? "";
    resolveTerminalGrant(id, false);
    expect(await p).toEqual({ denied: true });
    expect(written).toEqual([]);
  });

  it("writes with NO card when approval is off, the shipped default", async () => {
    const written: string[] = [];
    const r = await gatedTerminalInput("p2", "ls\n", deps(written, false));
    expect(r).toEqual({ sent: true });
    expect(written).toEqual(["ls\n"]);
    expect(listRequestsForWindow(1)).toHaveLength(0);
  });

  it("still errors on a dead pty when approval is off", async () => {
    // The label lookup has to run either way: a send to a pty that is gone is
    // an error, not a silent success that reports { sent: true }.
    const r = await gatedTerminalInput("gone", "hi", {
      write: () => true,
      label: () => null,
      askFirst: async () => false,
    });
    expect(r).toEqual({ error: "No such terminal (it may have closed)." });
  });
});

const deps2 = (written: string[]) => ({
  write: (_id: string, data: string) => {
    written.push(data);
    return true;
  },
  label: () => "proj",
  askFirst: async () => true,
});

it("submits a line an agent escaped as literal text, and previews what it will type", async () => {
  // `\rATLASPROBE ...` sat unsent at a prompt on 2026-08-31: the agent wrote
  // the two characters backslash and r, so the pty printed them instead of
  // submitting. The card must also show the decoded form -- approving bytes
  // other than the ones displayed is the wrong half to get right.
  const written: string[] = [];
  const p = gatedTerminalInput("p7", "git status\\n", deps2(written));
  await tick();
  const req = listRequestsForWindow(1)[0];
  expect(req?.kind).toBe("terminalGrant");
  resolveTerminalGrant(req?.requestId ?? "", true);
  expect(await p).toEqual({ sent: true });
  expect(written).toEqual(["git status\n"]);
});
