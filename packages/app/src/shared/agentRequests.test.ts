import { describe, expect, it } from "vitest";
import {
  AGENT_REQUEST_POLICY,
  type AgentRequest,
  bellCount,
  coalesceKey,
  isActionable,
  partitionRequests,
  shouldPruneOn,
  shouldPruneOnExpiry,
  VISIBLE_STACK_MAX,
} from "./agentRequests";

const secret = (over: Record<string, unknown> = {}): AgentRequest =>
  ({
    kind: "secret",
    requestId: "r1",
    state: "pending",
    createdAt: 1,
    dismissed: false,
    root: "/a",
    projectName: "a",
    name: "DATABASE_URL",
    ...over,
  }) as AgentRequest;

const grant = (over: Record<string, unknown> = {}): AgentRequest =>
  ({
    kind: "terminalGrant",
    requestId: "g1",
    state: "pending",
    createdAt: 1,
    dismissed: false,
    root: "/a",
    projectName: "a",
    ptyId: "p1",
    label: "a",
    preview: "ls",
    ...over,
  }) as AgentRequest;

describe("policy table", () => {
  it("declares every field for every kind", () => {
    for (const kind of ["secret", "terminalGrant"] as const) {
      const p = AGENT_REQUEST_POLICY[kind];
      expect(typeof p.actionableAfterExpiry, kind).toBe("boolean");
      expect(Array.isArray(p.pruneOn), kind).toBe(true);
      expect(typeof p.dismissible, kind).toBe("boolean");
      expect(typeof p.resolvesExternally, kind).toBe("boolean");
    }
  });

  it("keeps an expired secret actionable but not an expired grant", () => {
    // The asymmetry that must not be collapsed: vaulting a secret is still
    // useful whenever the user gets to it, but approving a grant after the send
    // already returned timedOut authorises nothing.
    expect(isActionable(secret({ state: "expired" }))).toBe(true);
    expect(isActionable(grant({ state: "expired" }))).toBe(false);
    expect(shouldPruneOnExpiry(secret())).toBe(false);
    expect(shouldPruneOnExpiry(grant())).toBe(true);
  });

  it("prunes a grant on pty exit, never a secret", () => {
    expect(shouldPruneOn(grant(), "ptyExit")).toBe(true);
    expect(shouldPruneOn(secret(), "ptyExit")).toBe(false);
  });
});

describe("coalesceKey", () => {
  it("matches two secret requests for the same root and name", () => {
    expect(coalesceKey(secret({ requestId: "x" }))).toBe(
      coalesceKey(secret({ requestId: "y" })),
    );
  });

  it("separates different names and different roots", () => {
    expect(coalesceKey(secret({ name: "OTHER" }))).not.toBe(
      coalesceKey(secret()),
    );
    expect(coalesceKey(secret({ root: "/b" }))).not.toBe(coalesceKey(secret()));
  });

  it("never coalesces grants", () => {
    expect(coalesceKey(grant())).toBeNull();
  });
});

describe("partitionRequests", () => {
  it("puts live undismissed requests in the stack, newest first", () => {
    const p = partitionRequests([
      secret({ requestId: "old", createdAt: 1 }),
      secret({ requestId: "new", createdAt: 2 }),
    ]);
    expect(p.stack.map((r) => r.requestId)).toEqual(["new", "old"]);
    expect(p.overflow).toBe(0);
    expect(p.bell).toEqual([]);
  });

  it("caps the stack and reports the overflow", () => {
    const many = Array.from({ length: VISIBLE_STACK_MAX + 2 }, (_, i) =>
      secret({ requestId: `r${i}`, createdAt: i }),
    );
    const p = partitionRequests(many);
    expect(p.stack).toHaveLength(VISIBLE_STACK_MAX);
    expect(p.overflow).toBe(2);
  });

  it("sends dismissed and non-actionable requests to the bell", () => {
    const p = partitionRequests([
      secret({ requestId: "d", dismissed: true }),
      grant({ requestId: "ge", state: "expired" }),
      secret({ requestId: "live" }),
    ]);
    expect(p.stack.map((r) => r.requestId)).toEqual(["live"]);
    expect(p.bell.map((r) => r.requestId).sort()).toEqual(["d", "ge"]);
  });

  it("keeps an EXPIRED but undismissed secret in the stack, not the bell", () => {
    // It must change state visibly rather than vanish, so the user can see why
    // Claude gave up instead of finding a silent dead end.
    const p = partitionRequests([secret({ requestId: "e", state: "expired" })]);
    expect(p.stack.map((r) => r.requestId)).toEqual(["e"]);
    expect(p.bell).toEqual([]);
  });

  it("counts only bell entries the user can still act on", () => {
    const p = partitionRequests([
      secret({ requestId: "d", dismissed: true }),
      grant({ requestId: "ge", state: "expired" }),
    ]);
    expect(bellCount(p.bell)).toBe(1);
  });
});
