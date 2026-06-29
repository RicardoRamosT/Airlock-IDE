import type { DevServerState } from "@airlock/agent-core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _setDepsForTest,
  getDevServerState,
  onPtyExitForDevServer,
  registerDevServer,
  stopDevServer,
} from "./manager";

// Inject fake deps before any manager function so electron is never imported.
function makeFakeDeps() {
  const broadcasts: Array<{ root: string; state: DevServerState }> = [];
  const inputs: Array<{ ptyId: string; data: string }> = [];
  _setDepsForTest({
    broadcast(root, state) {
      broadcasts.push({ root, state });
    },
    writeInput(ptyId, data) {
      inputs.push({ ptyId, data });
      return true;
    },
    async runStart(_command, _startedBy) {
      // no-op in unit tests; the renderer path is not exercised here
    },
  });
  return { broadcasts, inputs };
}

const ROOT = "/fake/project";

describe("manager container (smoke)", () => {
  beforeEach(() => {
    // Reset deps so each test starts clean.
    makeFakeDeps();
  });

  it("registerDevServer moves state to starting with correct terminalId", () => {
    const state = registerDevServer(
      ROOT,
      "term-1",
      "pty-1",
      "npm run dev",
      "agent",
    );
    expect(state.status).toBe("starting");
    expect(state.terminalId).toBe("term-1");
    expect(state.command).toBe("npm run dev");
    expect(state.startedBy).toBe("agent");
    // getDevServerState mirrors the same state
    expect(getDevServerState(ROOT).status).toBe("starting");
  });

  it("stopDevServer resets state to idle", () => {
    registerDevServer(ROOT, "term-1", "pty-1", "npm run dev", "agent");
    const state = stopDevServer(ROOT);
    expect(state.status).toBe("idle");
    expect(getDevServerState(ROOT).status).toBe("idle");
  });

  it("second registerDevServer while starting is idempotent (state unchanged)", () => {
    const first = registerDevServer(
      ROOT,
      "term-1",
      "pty-1",
      "npm run dev",
      "agent",
    );
    expect(first.status).toBe("starting");
    // A second call while starting should leave state unchanged (FSM idempotence)
    const second = registerDevServer(
      ROOT,
      "term-2",
      "pty-2",
      "npm run dev",
      "user",
    );
    expect(second.status).toBe("starting");
    // terminalId and startedBy remain from the FIRST call (FSM returned unchanged)
    expect(second.terminalId).toBe("term-1");
    expect(second.startedBy).toBe("agent");
  });

  it("stopDevServer sends SIGINT to the managed pty", () => {
    const { inputs } = makeFakeDeps();
    registerDevServer(ROOT, "term-1", "pty-1", "npm run dev", "agent");
    stopDevServer(ROOT);
    expect(inputs.some((i) => i.ptyId === "pty-1" && i.data === "\x03")).toBe(
      true,
    );
  });

  it("onPtyExitForDevServer resets state when the managed pty exits", () => {
    registerDevServer(ROOT, "term-1", "pty-1", "npm run dev", "agent");
    expect(getDevServerState(ROOT).status).toBe("starting");
    onPtyExitForDevServer("pty-1");
    expect(getDevServerState(ROOT).status).toBe("exited");
  });

  it("onPtyExitForDevServer is a no-op for unrelated pty ids", () => {
    registerDevServer(ROOT, "term-1", "pty-1", "npm run dev", "agent");
    onPtyExitForDevServer("pty-unrelated");
    // State still starting — unrelated pty had no effect
    expect(getDevServerState(ROOT).status).toBe("starting");
  });

  it("broadcast fires on register and stop", () => {
    const { broadcasts } = makeFakeDeps();
    registerDevServer(ROOT, "term-1", "pty-1", "npm run dev", "agent");
    stopDevServer(ROOT);
    expect(broadcasts.length).toBeGreaterThanOrEqual(2);
    const startBroadcast = broadcasts.find(
      (b) => b.state.status === "starting",
    );
    const stopBroadcast = broadcasts.find((b) => b.state.status === "idle");
    expect(startBroadcast).toBeDefined();
    expect(stopBroadcast).toBeDefined();
  });
});
