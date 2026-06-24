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
        {
          uid: "d1",
          name: "web",
          url: "u1",
          readyState: "BUILDING",
          meta: { branch: "main" },
        },
        {
          uid: "d2",
          name: "web",
          url: "u2",
          readyState: "READY",
          meta: { branch: "main" },
        },
        {
          uid: "d3",
          name: "api",
          url: "u3",
          readyState: "ERROR",
          meta: { branch: "fix" },
        },
      ],
    });
    expect(items).toEqual([
      {
        id: "int:demo:d1",
        title: "web",
        subtitle: "main",
        state: "running",
        href: "u1",
      },
      {
        id: "int:demo:d3",
        title: "api",
        subtitle: "fix",
        state: "failed",
        href: "u3",
      },
    ]);
  });

  it("omits href when the expr resolves to nothing", () => {
    const items = mapToItems(
      { ...M, map: { ...M.map, href: "$.nope" } },
      { deployments: [{ uid: "d1", name: "web", readyState: "BUILDING" }] },
    );
    expect(items).toEqual([
      { id: "int:demo:d1", title: "web", subtitle: "", state: "running" },
    ]);
    // toEqual above already proves href is absent; this documents the intent.
    expect("href" in (items[0] ?? {})).toBe(false);
  });

  it("returns [] when the items selector is not an array", () => {
    expect(mapToItems(M, { deployments: null })).toEqual([]);
  });

  it("treats the whole doc as one item when `items` is omitted", () => {
    const single: IntegrationManifest = {
      id: "solo",
      name: "Solo",
      detect: { authCheck: { cmd: "solo", args: ["whoami"] } },
      poll: { everyMs: 1000, cli: { cmd: "solo", args: ["status", "--json"] } },
      map: {
        title: "$.name",
        state: { from: "$.status", running: ["DEPLOYING"], default: "idle" },
      },
    };
    expect(mapToItems(single, { name: "svc", status: "DEPLOYING" })).toEqual([
      { id: "int:solo:svc", title: "svc", subtitle: "", state: "running" },
    ]);
  });
});

const AZ: IntegrationManifest = {
  id: "az",
  name: "Azure",
  detect: { authCheck: { cmd: "az", args: ["account", "show"] } },
  poll: { everyMs: 1000, cli: { cmd: "az", args: ["webapp", "list"] } },
  map: {
    items: "$",
    key: "$.name",
    title: "$.name",
    subtitle: "$.resourceGroup",
    state: { from: "$.state", running: ["Running"], default: "idle" },
    show: ["running", "idle"],
    details: [
      { label: "State", value: "$.state" },
      { label: "Region", value: "$.location" },
      { label: "URL", value: "$.defaultHostName" },
    ],
    actions: [
      {
        label: "Portal",
        icon: "link-external",
        kind: "url",
        template: "https://portal.azure.com/#@/resource{{$.id}}/overview",
      },
      {
        label: "Stop",
        icon: "debug-stop",
        kind: "command",
        template:
          "az webapp stop --name {{$.name}} --resource-group {{$.resourceGroup}}",
        when: ["running"],
      },
    ],
  },
};

describe("mapToItems details and actions", () => {
  it("resolves detail exprs and skips empty ones", () => {
    const [item] = mapToItems(AZ, [
      {
        name: "app",
        resourceGroup: "rg",
        state: "Running",
        location: "eastus",
        id: "/x",
        defaultHostName: "", // empty -> URL detail omitted
      },
    ]);
    expect(item?.details).toEqual([
      { label: "State", value: "Running" },
      { label: "Region", value: "eastus" },
    ]);
  });

  it("resolves a url action template by raw substitution", () => {
    const [item] = mapToItems(AZ, [
      {
        name: "app",
        resourceGroup: "rg",
        state: "Running",
        id: "/subscriptions/s/rg/sites/app",
      },
    ]);
    expect(item?.actions?.find((a) => a.label === "Portal")).toEqual({
      label: "Portal",
      icon: "link-external",
      kind: "url",
      target:
        "https://portal.azure.com/#@/resource/subscriptions/s/rg/sites/app/overview",
    });
  });

  it("resolves a command action, shell-quotes args, and carries `when`", () => {
    const [item] = mapToItems(AZ, [
      { name: "app", resourceGroup: "rg", state: "Running", id: "/x" },
    ]);
    expect(item?.actions?.find((a) => a.label === "Stop")).toEqual({
      label: "Stop",
      icon: "debug-stop",
      kind: "command",
      target: "az webapp stop --name 'app' --resource-group 'rg'",
      when: ["running"],
    });
  });

  it("escapes a malicious name so it cannot break out of the command", () => {
    const [item] = mapToItems(AZ, [
      {
        name: "a'; rm -rf ~ #",
        resourceGroup: "rg",
        state: "Running",
        id: "/x",
      },
    ]);
    // The single quote becomes '\'' so the whole name stays one literal arg.
    expect(item?.actions?.find((a) => a.label === "Stop")?.target).toBe(
      "az webapp stop --name 'a'\\''; rm -rf ~ #' --resource-group 'rg'",
    );
  });

  it("drops an action whose template placeholder resolves to nothing", () => {
    const [item] = mapToItems(AZ, [
      { name: "app", resourceGroup: "rg", state: "Running" /* no id */ },
    ]);
    // Portal needs {{$.id}}; absent -> dropped, not rendered broken.
    expect(item?.actions?.some((a) => a.label === "Portal")).toBe(false);
    expect(item?.actions?.some((a) => a.label === "Stop")).toBe(true);
  });

  it("omits details/actions entirely when the manifest defines none", () => {
    const items = mapToItems(M, {
      deployments: [
        {
          uid: "d1",
          name: "web",
          url: "u1",
          readyState: "BUILDING",
          meta: { branch: "main" },
        },
      ],
    });
    expect("details" in (items[0] ?? {})).toBe(false);
    expect("actions" in (items[0] ?? {})).toBe(false);
  });
});
