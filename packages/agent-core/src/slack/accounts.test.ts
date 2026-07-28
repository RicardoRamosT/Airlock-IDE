import { describe, expect, it } from "vitest";
import {
  resolveSlackWorkspaceId,
  type SlackWorkspaceRef,
  sortWorkspaces,
  upsertWorkspace,
} from "./accounts";

const ref = (id: string, name = id, domain = id): SlackWorkspaceRef => ({
  id,
  name,
  domain,
});

describe("upsertWorkspace", () => {
  it("adds a workspace that is not in the pool", () => {
    expect(upsertWorkspace([], ref("T1")).map((w) => w.id)).toEqual(["T1"]);
  });

  it("REPLACES by team id instead of duplicating", () => {
    // Re-connecting the same workspace must refresh its label, not add a
    // second row that shadows the first.
    const pool = upsertWorkspace([ref("T1", "Old")], ref("T1", "New"));
    expect(pool).toHaveLength(1);
    expect(pool[0]?.name).toBe("New");
  });

  it("leaves other workspaces untouched", () => {
    const pool = upsertWorkspace([ref("T1"), ref("T2")], ref("T1", "New"));
    expect(pool.map((w) => w.id).sort()).toEqual(["T1", "T2"]);
  });

  it("does not mutate the input", () => {
    const original = [ref("T1")];
    upsertWorkspace(original, ref("T2"));
    expect(original).toHaveLength(1);
  });
});

describe("resolveSlackWorkspaceId", () => {
  it("returns the bound id when it is still in the pool", () => {
    expect(resolveSlackWorkspaceId("T1", [ref("T1")])).toBe("T1");
  });

  it("returns null when NOTHING is bound, even with exactly one workspace", () => {
    // The load-bearing rule. Neon auto-binds a sole account; Slack must not,
    // or opening a new project silently joins it to a workspace.
    expect(resolveSlackWorkspaceId(null, [ref("T1")])).toBeNull();
  });

  it("returns null when the bound workspace has been removed from the pool", () => {
    // A dangling binding must read as disconnected, not throw and not
    // silently fall through to some other workspace.
    expect(resolveSlackWorkspaceId("T9", [ref("T1")])).toBeNull();
  });

  it("returns null for an empty pool", () => {
    expect(resolveSlackWorkspaceId("T1", [])).toBeNull();
  });
});

describe("sortWorkspaces", () => {
  it("orders by name, case-insensitively", () => {
    const out = sortWorkspaces([ref("T1", "zeta"), ref("T2", "Alpha")]);
    expect(out.map((w) => w.name)).toEqual(["Alpha", "zeta"]);
  });

  it("does not mutate the input", () => {
    const original = [ref("T1", "b"), ref("T2", "a")];
    sortWorkspaces(original);
    expect(original[0]?.name).toBe("b");
  });
});
