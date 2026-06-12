// packages/agent-core/src/integrations/map.test.ts
import { describe, expect, it } from "vitest";
import type { IntegrationManifest, StateSpec } from "./manifest";
import { applyState, mapToItems } from "./map";

const STATE: StateSpec = {
  from: "$.readyState",
  running: ["BUILDING", "QUEUED"],
  done: ["READY"],
  failed: ["ERROR"],
  default: "idle",
};

describe("applyState", () => {
  it("maps source status strings onto the four states", () => {
    expect(applyState(STATE, { readyState: "BUILDING" })).toBe("running");
    expect(applyState(STATE, { readyState: "READY" })).toBe("done");
    expect(applyState(STATE, { readyState: "ERROR" })).toBe("failed");
    expect(applyState(STATE, { readyState: "WHATEVER" })).toBe("idle");
  });
});

const M: IntegrationManifest = {
  id: "demo",
  name: "Demo",
  detect: { authCheck: { cmd: "demo", args: ["whoami"] } },
  poll: { everyMs: 1000, cli: { cmd: "demo", args: ["ls", "--json"] } },
  map: {
    items: "$.deployments",
    key: "$.uid",
    title: "$.name",
    subtitle: "$.meta.branch",
    href: "$.url",
    state: STATE,
  },
};

describe("mapToItems", () => {
  it("surfaces only running/failed by default, with prefixed ids", () => {
    const items = mapToItems(M, {
      deployments: [
        { uid: "d1", name: "web", url: "u1", readyState: "BUILDING", meta: { branch: "main" } },
        { uid: "d2", name: "web", url: "u2", readyState: "READY", meta: { branch: "main" } },
        { uid: "d3", name: "api", url: "u3", readyState: "ERROR", meta: { branch: "fix" } },
      ],
    });
    expect(items).toEqual([
      { id: "int:demo:d1", title: "web", subtitle: "main", state: "running", href: "u1" },
      { id: "int:demo:d3", title: "api", subtitle: "fix", state: "failed", href: "u3" },
    ]);
  });

  it("omits href when the expr resolves to nothing", () => {
    const [item] = mapToItems(
      { ...M, map: { ...M.map, href: "$.nope" } },
      { deployments: [{ uid: "d1", name: "web", readyState: "BUILDING" }] },
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const it2 = item!;
    expect(it2).toEqual({ id: "int:demo:d1", title: "web", subtitle: "", state: "running" });
    expect("href" in it2).toBe(false);
  });

  it("returns [] when the items selector is not an array", () => {
    expect(mapToItems(M, { deployments: null })).toEqual([]);
  });
});
