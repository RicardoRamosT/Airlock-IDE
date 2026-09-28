import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Container } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import type { ProcInfo } from "./detect";
import {
  longRunningContainers,
  longRunningProcesses,
  type ScanProbes,
  scanLocalApps,
} from "./scan";

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
    [36019, { startedAt: NOW - 134 * HOUR, command: "next-server (v16)" }],
    [999, { startedAt: NOW - 2 * HOUR, command: "vite" }],
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

  it("ignores AirLock's own processes", () => {
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

  it("reports a socket shared by a supervisor and its worker ONCE, as the supervisor", () => {
    // uvicorn --reload, observed 2026-09-28: the reloader binds :8000 and its
    // worker inherits the SAME socket, so lsof lists the port under both pids.
    // The card belongs to the reloader -- SIGTERM to it takes the worker down,
    // while SIGTERM to the worker leaves the reloader holding the port. The
    // supervisor is always the OLDER of the two: a parent starts before its
    // child.
    const got = longRunningProcesses(
      [
        { pid: 27003, port: 8000 }, // the worker, listed first
        { pid: 40248, port: 8000 }, // the reloader
      ],
      new Map([
        [27003, "/p/app/server_py"],
        [40248, "/p/app/server_py"],
      ]),
      new Map<number, ProcInfo>([
        [
          27003,
          { startedAt: NOW - 96 * HOUR, command: "Python -c spawn_main" },
        ],
        [40248, { startedAt: NOW - 109 * HOUR, command: "Python uvicorn" }],
      ]),
      roots,
      NOW,
      24,
      none,
      noManaged,
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ pid: 40248, detail: "Python uvicorn" });
  });
});

describe("scanLocalApps", () => {
  // The real shape, observed 2026-09-28: every dev server on the machine had
  // been started by Claude from an AirLock terminal, so each one DESCENDS from
  // AirLock --
  //   AirLock -> zsh (the terminal) -> claude -> zsh -c -> npm run dev -> vite
  // Three of them had been up 1.5 to 4.5 days and the bell said nothing.
  const AIRLOCK = 74099;
  const ages = new Map<number, ProcInfo>([
    [AIRLOCK, { startedAt: NOW - 121 * HOUR, command: "AirLock" }],
    [36884, { startedAt: NOW - 108 * HOUR, command: "zsh" }], // the terminal
    [37167, { startedAt: NOW - 108 * HOUR, command: "claude" }],
    [40172, { startedAt: NOW - 108 * HOUR, command: "npm run dev" }],
    [40232, { startedAt: NOW - 108 * HOUR, command: "vite" }],
  ]);
  const probes: ScanProbes = {
    processAges: () => ages,
    listeningPorts: () => [
      { pid: AIRLOCK, port: 4319 }, // its own MCP server
      { pid: 40232, port: 5100 },
    ],
    cwdsForPids: (pids) =>
      new Map(
        pids.flatMap((p): [number, string][] =>
          p === AIRLOCK
            ? [[p, "/p/airlock"]] // run from source, AirLock's cwd IS a root
            : p === 40232
              ? [[p, "/p/LendLogic"]]
              : [],
        ),
      ),
    containers: async () => ({
      installed: false,
      running: false,
      containers: [],
    }),
    containerStartedAt: async () => new Map(),
  };
  const deps = {
    roots: () => ["/p/airlock", "/p/LendLogic"],
    managedPorts: () => new Set<number>(),
    now: () => NOW,
    ownPids: () => new Set([AIRLOCK]),
  };

  it("reports a server started from an AirLock terminal", async () => {
    const got = await scanLocalApps(deps, 24, probes);
    expect(got.map((a) => a.name)).toContain("LendLogic on :5100");
  });

  it("never reports AirLock itself", async () => {
    const got = await scanLocalApps(deps, 24, probes);
    expect(got.map((a) => a.name)).not.toContain("airlock on :4319");
  });
});

describe("AirLock's own pids are actually wired", () => {
  // The compiler forces an `ownPids` dependency but not what it returns: a
  // subtree walk from process.pid would type-check perfectly and hide every
  // server started from an AirLock terminal again.
  const poll = readFileSync(join(__dirname, "index.ts"), "utf8");

  it("comes from Electron's own process set, not a walk of its descendants", () => {
    expect(poll).toContain("app.getAppMetrics()");
    expect(poll).not.toMatch(/subtree(Of|Pids)\(/);
  });
});
