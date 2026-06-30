import { describe, expect, it } from "vitest";
import { pickUnverifiedPorts } from "./detect";
import {
  devServerNextState,
  IDLE_DEV_SERVER,
  pickListeningPortFromSubtree,
  pickUnmanagedServer,
  resolveDevCommand,
} from "./devserver";

describe("resolveDevCommand", () => {
  it("prefers an explicit configured devCommand verbatim", () => {
    expect(
      resolveDevCommand(
        { devCommand: "make serve" },
        '{"scripts":{"dev":"vite"}}',
        ["package-lock.json"],
      ),
    ).toBe("make serve");
  });
  it("guesses `<pm> run dev` from a dev script, pm by lockfile", () => {
    const pkg = '{"scripts":{"dev":"vite"}}';
    expect(resolveDevCommand({}, pkg, ["package-lock.json"])).toBe(
      "npm run dev",
    );
    expect(resolveDevCommand({}, pkg, ["pnpm-lock.yaml"])).toBe("pnpm run dev");
    expect(resolveDevCommand({}, pkg, ["yarn.lock"])).toBe("yarn run dev");
    expect(resolveDevCommand({}, pkg, ["bun.lockb"])).toBe("bun run dev");
  });
  it("defaults to npm when no lockfile matches", () => {
    expect(resolveDevCommand({}, '{"scripts":{"dev":"vite"}}', [])).toBe(
      "npm run dev",
    );
  });
  it("falls back to the start script when there is no dev script", () => {
    expect(
      resolveDevCommand({}, '{"scripts":{"start":"node ."}}', [
        "package-lock.json",
      ]),
    ).toBe("npm run start");
  });
  it("returns null when no command can be derived", () => {
    expect(resolveDevCommand({}, '{"scripts":{"build":"tsc"}}', [])).toBeNull();
    expect(resolveDevCommand({}, null, [])).toBeNull();
    expect(resolveDevCommand({}, "not json", [])).toBeNull();
    expect(resolveDevCommand({ devCommand: "  " }, null, [])).toBeNull(); // blank is not a command
  });
});

describe("pickListeningPortFromSubtree", () => {
  it("returns the first port owned by a PID in the subtree", () => {
    const ports = [
      { pid: 999, port: 5173 }, // not ours (e.g. airlock's own server)
      { pid: 222, port: 3000 }, // ours
    ];
    expect(pickListeningPortFromSubtree(ports, new Set([111, 222]))).toBe(3000);
  });
  it("ignores ports owned by unrelated PIDs (the crux of the fix)", () => {
    expect(
      pickListeningPortFromSubtree(
        [{ pid: 999, port: 5173 }],
        new Set([111, 222]),
      ),
    ).toBeNull();
  });
  it("returns null when there are no listening ports", () => {
    expect(pickListeningPortFromSubtree([], new Set([111]))).toBeNull();
  });
});

describe("devServerNextState", () => {
  const started = devServerNextState(IDLE_DEV_SERVER, {
    type: "start",
    command: "npm run dev",
    terminalId: "t1",
    startedBy: "agent",
  });
  it("idle + start -> starting (carries command/terminal/startedBy)", () => {
    expect(started).toEqual({
      status: "starting",
      url: null,
      port: null,
      terminalId: "t1",
      command: "npm run dev",
      startedBy: "agent",
      exitCode: null,
    });
  });
  it("starting + port -> running with a localhost url", () => {
    const running = devServerNextState(started, { type: "port", port: 5173 });
    expect(running.status).toBe("running");
    expect(running.url).toBe("http://localhost:5173");
    expect(running.port).toBe(5173);
  });
  it("start is idempotent while starting/running", () => {
    const again = devServerNextState(started, {
      type: "start",
      command: "other",
      terminalId: "t2",
      startedBy: "user",
    });
    expect(again).toBe(started); // unchanged reference -> no-op
  });
  it("exit -> exited with the code, preserving the url for display", () => {
    const running = devServerNextState(started, { type: "port", port: 5173 });
    const exited = devServerNextState(running, { type: "exit", code: 1 });
    expect(exited.status).toBe("exited");
    expect(exited.exitCode).toBe(1);
  });
  it("stop -> idle (clean slate)", () => {
    expect(devServerNextState(started, { type: "stop" })).toEqual(
      IDLE_DEV_SERVER,
    );
  });
  it("exit while idle is a no-op", () => {
    expect(devServerNextState(IDLE_DEV_SERVER, { type: "exit", code: 0 })).toBe(
      IDLE_DEV_SERVER,
    );
  });
});

describe("pickUnmanagedServer", () => {
  const ports = [
    { pid: 999, port: 5173 }, // unrelated (e.g. AirLock's own server)
    { pid: 222, port: 5001 }, // owned by terminal B's subtree
  ];
  it("returns the first terminal whose subtree owns a listening port, with its ptyId", () => {
    const terminals = [
      { ptyId: "pty-A", pids: new Set([10, 11]) }, // owns nothing listening
      { ptyId: "pty-B", pids: new Set([200, 222]) }, // owns :5001
    ];
    expect(pickUnmanagedServer(terminals, ports)).toEqual({
      port: 5001,
      ptyId: "pty-B",
    });
  });
  it("ignores ports owned by pids outside every terminal subtree (the false-positive guard)", () => {
    const terminals = [{ ptyId: "pty-A", pids: new Set([10, 11]) }];
    expect(pickUnmanagedServer(terminals, ports)).toBeNull();
  });
  it("returns null when there are no terminals or no listening ports", () => {
    expect(pickUnmanagedServer([], ports)).toBeNull();
    expect(
      pickUnmanagedServer([{ ptyId: "pty-A", pids: new Set([222]) }], []),
    ).toBeNull();
  });
});

describe("pickUnverifiedPorts", () => {
  const common = [5173, 5174, 3000, 5001];
  it("returns common listening ports that are neither managed nor owned by an excluded pid", () => {
    const listening = [
      { pid: 10, port: 5001 }, // keep (unattributable, common)
      { pid: 20, port: 5173 }, // excluded pid (this project's terminal) -> drop
      { pid: 30, port: 3000 }, // managed port -> drop
      { pid: 40, port: 49152 }, // not a common dev port -> drop
    ];
    expect(pickUnverifiedPorts(listening, common, new Set([20]), 3000)).toEqual(
      [5001],
    );
  });
  it("dedupes and sorts", () => {
    const listening = [
      { pid: 1, port: 5174 },
      { pid: 2, port: 5001 },
      { pid: 3, port: 5001 },
    ];
    expect(pickUnverifiedPorts(listening, common, new Set(), null)).toEqual([
      5001, 5174,
    ]);
  });
  it("returns [] when nothing qualifies", () => {
    expect(pickUnverifiedPorts([], common, new Set(), null)).toEqual([]);
    expect(
      pickUnverifiedPorts([{ pid: 1, port: 9999 }], common, new Set(), null),
    ).toEqual([]);
  });
});
