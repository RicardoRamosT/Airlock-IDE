import type { Container } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import type { ProcInfo } from "./detect";
import { longRunningContainers, longRunningProcesses } from "./scan";

const HOUR = 3600 * 1000;
const NOW = 1_800_000_000_000;

function container(over: Partial<Container> = {}): Container {
  return {
    id: "c1",
    name: "trackview-postgres-1",
    image: "postgres:17",
    state: "running",
    status: "Up",
    ports: "",
    project: "trackview",
    projectDir: "/p/Trackview",
    ...over,
  };
}

describe("longRunningContainers", () => {
  it("reports a container up longer than the threshold, attributed to its project", () => {
    const got = longRunningContainers(
      [container()],
      new Map([["c1", NOW - 30 * HOUR]]),
      NOW,
      24,
    );
    expect(got).toEqual([
      {
        appType: "container",
        appId: "c1",
        name: "trackview-postgres-1",
        detail: "postgres:17",
        startedAt: NOW - 30 * HOUR,
        root: "/p/Trackview",
        projectName: "trackview",
      },
    ]);
  });

  it("ignores one under the threshold", () => {
    expect(
      longRunningContainers(
        [container()],
        new Map([["c1", NOW - 23 * HOUR]]),
        NOW,
        24,
      ),
    ).toEqual([]);
  });

  it("ignores a STOPPED container however old", () => {
    // A stopped container costs nothing, which is the entire point.
    expect(
      longRunningContainers(
        [container({ state: "exited" })],
        new Map([["c1", NOW - 1000 * HOUR]]),
        NOW,
        24,
      ),
    ).toEqual([]);
  });

  it("skips a container whose start time could not be read, rather than guessing", () => {
    expect(longRunningContainers([container()], new Map(), NOW, 24)).toEqual(
      [],
    );
  });
});

describe("longRunningProcesses", () => {
  const roots = ["/p/ElArqui", "/p/app"];
  const ages = new Map<number, ProcInfo>([
    [
      36019,
      { ppid: 1, startedAt: NOW - 134 * HOUR, command: "next-server (v16)" },
    ],
    [999, { ppid: 1, startedAt: NOW - 2 * HOUR, command: "vite" }],
  ]);
  const cwds = new Map<number, string>([
    [36019, "/p/ElArqui"],
    [999, "/p/app"],
    [1765, "/"],
  ]);
  const none = new Set<number>();
  const noManaged = new Set<number>();

  it("catches a server on a port no dev-port list contains", () => {
    // 3005 is not in COMMON_DEV_PORTS; the cwd is what qualifies it.
    const got = longRunningProcesses(
      [{ pid: 36019, port: 3005 }],
      cwds,
      ages,
      roots,
      NOW,
      24,
      none,
      noManaged,
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      appType: "detectedServer",
      appId: "3005",
      name: "ElArqui on :3005",
      detail: "next-server (v16)",
      root: "/p/ElArqui",
      projectName: "ElArqui",
    });
  });

  it("marks a managed port as managed, so the right stop path is used", () => {
    const got = longRunningProcesses(
      [{ pid: 36019, port: 3005 }],
      cwds,
      ages,
      roots,
      NOW,
      24,
      none,
      new Set([3005]),
    );
    expect(got[0]?.appType).toBe("managedServer");
  });

  it("ignores a process outside every project (the OS is not the user's app)", () => {
    expect(
      longRunningProcesses(
        [{ pid: 1765, port: 3310 }],
        cwds,
        ages,
        roots,
        NOW,
        24,
        none,
        noManaged,
      ),
    ).toEqual([]);
  });

  it("ignores AirLock's own subtree", () => {
    // Run from source, AirLock's cwd IS a project root.
    expect(
      longRunningProcesses(
        [{ pid: 36019, port: 3005 }],
        cwds,
        ages,
        roots,
        NOW,
        24,
        new Set([36019]),
        noManaged,
      ),
    ).toEqual([]);
  });

  it("ignores a young process", () => {
    expect(
      longRunningProcesses(
        [{ pid: 999, port: 5173 }],
        cwds,
        ages,
        roots,
        NOW,
        24,
        none,
        noManaged,
      ),
    ).toEqual([]);
  });

  it("reports one notice per process, not per bound port", () => {
    // A server on both IPv4 and IPv6, or on two ports, is still one app.
    const got = longRunningProcesses(
      [
        { pid: 36019, port: 3005 },
        { pid: 36019, port: 3005 },
        { pid: 36019, port: 9229 },
      ],
      cwds,
      ages,
      roots,
      NOW,
      24,
      none,
      noManaged,
    );
    expect(got).toHaveLength(1);
    expect(got[0]?.appId).toBe("3005"); // the lowest, the one a human knows
  });
});
