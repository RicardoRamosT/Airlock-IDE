import type { CiRun } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import type { ActivityItem } from "../shared/ipc";
import {
  addDismissedActivity,
  ciRunState,
  ciRunToItem,
  dockerContainerToItem,
  filterDismissed,
  integrationItemToItem,
  isActivityDismissed,
  renderDeployState,
  renderServiceToItem,
} from "./activity";

const item = (id: string): ActivityItem => ({
  id,
  kind: "ci",
  title: "CI",
  subtitle: "main",
  state: "running",
  progress: null,
});

const ci = (over: Partial<CiRun>): CiRun => ({
  workflowName: "CI",
  status: "in_progress",
  conclusion: null,
  headSha: "abc",
  url: "u",
  steps: [],
  stepsDone: 0,
  stepsTotal: 0,
  ...over,
});

describe("ciRunState", () => {
  it("running while not completed", () => {
    expect(ciRunState(ci({ status: "in_progress" }))).toBe("running");
    expect(ciRunState(ci({ status: "queued" }))).toBe("running");
  });
  it("done on success", () => {
    expect(ciRunState(ci({ status: "completed", conclusion: "success" }))).toBe(
      "done",
    );
  });
  it("failed on failure/cancelled/timed_out", () => {
    expect(ciRunState(ci({ status: "completed", conclusion: "failure" }))).toBe(
      "failed",
    );
    expect(
      ciRunState(ci({ status: "completed", conclusion: "cancelled" })),
    ).toBe("failed");
    expect(
      ciRunState(ci({ status: "completed", conclusion: "timed_out" })),
    ).toBe("failed");
  });
  it("idle on skipped/neutral/null", () => {
    expect(ciRunState(ci({ status: "completed", conclusion: "skipped" }))).toBe(
      "idle",
    );
    expect(ciRunState(ci({ status: "completed", conclusion: null }))).toBe(
      "idle",
    );
  });
});

describe("ciRunToItem", () => {
  it("determinate progress from steps", () => {
    const item = ciRunToItem(
      ci({ headSha: "abc", stepsDone: 3, stepsTotal: 6 }),
      "main",
    );
    expect(item.progress).toEqual({
      kind: "determinate",
      value: 50,
      label: "3/6 steps",
    });
    expect(item.id).toBe("ci:abc");
    expect(item.subtitle).toBe("main");
    expect(item.kind).toBe("ci");
  });
  it("indeterminate when running with no steps", () => {
    const item = ciRunToItem(
      ci({ status: "queued", url: "", stepsTotal: 0 }),
      "main",
    );
    expect(item.progress).toEqual({ kind: "indeterminate" });
    expect(item.href).toBeUndefined();
  });
  it("null progress when finished with no steps", () => {
    const item = ciRunToItem(
      ci({ status: "completed", conclusion: "success", stepsTotal: 0 }),
      "main",
    );
    expect(item.progress).toBeNull();
    expect(item.state).toBe("done");
  });
});

describe("renderDeployState", () => {
  it("maps Render deploy statuses", () => {
    expect(renderDeployState("build_in_progress")).toBe("running");
    expect(renderDeployState("update_in_progress")).toBe("running");
    expect(renderDeployState("live")).toBe("done");
    expect(renderDeployState("update_failed")).toBe("failed");
    expect(renderDeployState("canceled")).toBe("failed");
    expect(renderDeployState("")).toBe("idle");
  });
});

describe("renderServiceToItem", () => {
  it("surfaces a building service as running+indeterminate", () => {
    const item = renderServiceToItem({
      id: "s1",
      name: "api",
      url: "u",
      deployStatus: "build_in_progress",
    });
    expect(item?.state).toBe("running");
    expect(item?.progress).toEqual({ kind: "indeterminate" });
  });
  it("surfaces a failed deploy with null progress", () => {
    const item = renderServiceToItem({
      id: "s1",
      name: "api",
      url: "u",
      deployStatus: "update_failed",
    });
    expect(item?.state).toBe("failed");
    expect(item?.progress).toBeNull();
  });
  it("hides a live (steady-state) service", () => {
    expect(
      renderServiceToItem({
        id: "s1",
        name: "api",
        url: "u",
        deployStatus: "live",
      }),
    ).toBeNull();
  });
});

describe("dockerContainerToItem", () => {
  it("surfaces a restarting/created container", () => {
    expect(
      dockerContainerToItem({
        id: "c1",
        name: "db",
        state: "restarting",
        status: "Restarting",
      })?.kind,
    ).toBe("docker");
    expect(
      dockerContainerToItem({
        id: "c2",
        name: "db",
        state: "created",
        status: "Created",
      })?.progress,
    ).toEqual({
      kind: "indeterminate",
    });
  });
  it("hides a running or exited container", () => {
    expect(
      dockerContainerToItem({
        id: "c1",
        name: "db",
        state: "running",
        status: "Up 3h",
      }),
    ).toBeNull();
    expect(
      dockerContainerToItem({
        id: "c2",
        name: "db",
        state: "exited",
        status: "Exited (0)",
      }),
    ).toBeNull();
  });
});

describe("filterDismissed", () => {
  it("excludes ids in the dismissed set, keeps the rest", () => {
    const items = [item("ci:abc"), item("render:s1"), item("docker:c1")];
    const out = filterDismissed(items, new Set(["ci:abc"]));
    expect(out.map((i) => i.id)).toEqual(["render:s1", "docker:c1"]);
  });
  it("returns all items when nothing is dismissed", () => {
    const items = [item("ci:abc"), item("render:s1")];
    expect(filterDismissed(items, new Set()).map((i) => i.id)).toEqual([
      "ci:abc",
      "render:s1",
    ]);
  });
});

describe("addDismissedActivity / isActivityDismissed", () => {
  it("marks an id dismissed so the module set filters it out", () => {
    expect(isActivityDismissed("ci:dismiss-me")).toBe(false);
    addDismissedActivity("ci:dismiss-me");
    expect(isActivityDismissed("ci:dismiss-me")).toBe(true);
    // The same set activityStatus uses, so a list built with that id is excluded.
    const items = [item("ci:dismiss-me"), item("ci:keep-me")];
    const out = filterDismissed(
      items,
      new Set(items.filter((i) => isActivityDismissed(i.id)).map((i) => i.id)),
    );
    expect(out.map((i) => i.id)).toEqual(["ci:keep-me"]);
  });
});

it("integrationItemToItem maps a neutral IntegrationItem to an ActivityItem", () => {
  expect(
    integrationItemToItem({
      id: "int:vercel:dpl_1",
      title: "web",
      subtitle: "main",
      state: "running",
      href: "u1",
    }),
  ).toEqual({
    id: "int:vercel:dpl_1",
    kind: "integration",
    title: "web",
    subtitle: "main",
    state: "running",
    progress: { kind: "indeterminate" },
    href: "u1",
  });
});

it("integrationItemToItem gives a failed item no progress and omits an empty href", () => {
  expect(
    integrationItemToItem({
      id: "int:vercel:dpl_3",
      title: "api",
      subtitle: "fix",
      state: "failed",
    }),
  ).toEqual({
    id: "int:vercel:dpl_3",
    kind: "integration",
    title: "api",
    subtitle: "fix",
    state: "failed",
    progress: null,
  });
});
