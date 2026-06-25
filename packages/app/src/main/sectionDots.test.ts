import { describe, expect, it } from "vitest";
import type { ActivityItem, GitStatus } from "../shared/ipc";
import {
  activityDot,
  databasesDot,
  dockerDot,
  gitDot,
  hostDot,
} from "./sectionDots";

const docker = (installed: boolean, running: boolean, states: string[]) => ({
  installed,
  running,
  containers: states.map((state, i) => ({
    id: `c${i}`,
    name: `c${i}`,
    image: "img",
    state,
    status: "",
  })),
});

describe("dockerDot", () => {
  it("grey when not installed", () => {
    expect(dockerDot(docker(false, false, []))).toBe("grey");
  });
  it("yellow when installed but daemon down or nothing running", () => {
    expect(dockerDot(docker(true, false, []))).toBe("yellow");
    expect(dockerDot(docker(true, true, ["exited"]))).toBe("yellow");
  });
  it("green when daemon up with a running container", () => {
    expect(dockerDot(docker(true, true, ["exited", "running"]))).toBe("green");
  });
});

describe("databasesDot", () => {
  it("grey when nothing configured", () => {
    expect(databasesDot([], false)).toBe("grey");
  });
  it("green when a postgres is reachable or Neon is connected", () => {
    expect(databasesDot([{ reachable: true }], false)).toBe("green");
    expect(databasesDot([], true)).toBe("green");
  });
  it("yellow when configured but nothing reachable", () => {
    expect(databasesDot([{ reachable: false }], false)).toBe("yellow");
  });
});

describe("hostDot", () => {
  it("green when the dev server is up or a deploy is live", () => {
    expect(hostDot(true, true, false, false)).toBe("green");
    expect(hostDot(null, false, true, true)).toBe("green");
  });
  it("yellow when configured but down/not live", () => {
    expect(hostDot(false, true, false, false)).toBe("yellow");
    expect(hostDot(null, false, false, true)).toBe("yellow");
  });
  it("grey when nothing configured", () => {
    expect(hostDot(null, false, false, false)).toBe("grey");
  });
});

const git = (
  staged: number,
  unstaged: number,
  untracked: number,
  ahead: number,
  behind: number,
): GitStatus =>
  ({
    branch: { head: "main", upstream: "origin/main", ahead, behind },
    staged: Array(staged).fill({ path: "a", index: "M", worktree: " " }),
    unstaged: Array(unstaged).fill({ path: "b", index: " ", worktree: "M" }),
    untracked: Array(untracked).fill("c"),
  }) as unknown as GitStatus;

describe("gitDot", () => {
  it("grey when not a repo", () => {
    expect(gitDot(null)).toBe("grey");
  });
  it("green when clean and in sync", () => {
    expect(gitDot(git(0, 0, 0, 0, 0))).toBe("green");
  });
  it("yellow when dirty or ahead/behind", () => {
    expect(gitDot(git(1, 0, 0, 0, 0))).toBe("yellow");
    expect(gitDot(git(0, 0, 0, 2, 0))).toBe("yellow");
    expect(gitDot(git(0, 0, 0, 0, 3))).toBe("yellow");
  });
});

const item = (state: ActivityItem["state"]): ActivityItem =>
  ({
    id: state,
    kind: "ci",
    title: "t",
    subtitle: "",
    state,
    progress: null,
  }) as ActivityItem;

describe("activityDot", () => {
  it("grey when idle (no items)", () => {
    expect(activityDot([])).toBe("grey");
  });
  it("red when any item failed", () => {
    expect(activityDot([item("running"), item("failed")])).toBe("red");
  });
  it("yellow when something is running (and none failed)", () => {
    expect(activityDot([item("running"), item("done")])).toBe("yellow");
  });
  it("green when items present and all finished", () => {
    expect(activityDot([item("done"), item("idle")])).toBe("green");
  });
});
