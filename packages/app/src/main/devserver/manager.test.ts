import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DevServerState } from "@airlock/agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetForTest,
  _setDepsForTest,
  devServerPtyId,
  getDevServerState,
  onPtyExitForDevServer,
  registerDevServer,
  startDevServer,
  stopDevServer,
} from "./manager";

// Inject fake deps before any manager function so electron is never imported.
function makeFakeDeps() {
  const broadcasts: Array<{ root: string; state: DevServerState }> = [];
  const inputs: Array<{ ptyId: string; data: string }> = [];
  const starts: Array<{ command: string; startedBy: "user" | "agent" }> = [];
  _setDepsForTest({
    broadcast(root, state) {
      broadcasts.push({ root, state });
    },
    writeInput(ptyId, data) {
      inputs.push({ ptyId, data });
      return true;
    },
    async runStart(command, startedBy) {
      starts.push({ command, startedBy });
    },
  });
  return { broadcasts, inputs, starts };
}

const ROOT = "/fake/project";

describe("manager container (smoke)", () => {
  beforeEach(() => {
    // Reset module state and deps so each test starts clean.
    _resetForTest();
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

  it("second registerDevServer does not clobber pty mapping", () => {
    registerDevServer(ROOT, "term-1", "pty-1", "npm run dev", "agent");
    expect(devServerPtyId(ROOT)).toBe("pty-1");
    // A second call while starting should NOT overwrite the pty mapping
    registerDevServer(ROOT, "term-2", "pty-2", "npm run dev", "user");
    expect(devServerPtyId(ROOT)).toBe("pty-1");
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

// startDevServer reads .airlock/config.json and package.json from the ROOT, so
// these tests use a real temp dir: no config file => devCommand unset (the
// "no configured command" case), and the presence/shape of package.json drives
// the resolved guess (resolveDevCommand: <pm> run dev|start, npm when no lockfile).
describe("startDevServer command resolution", () => {
  let dir: string;
  let deps: ReturnType<typeof makeFakeDeps>;

  beforeEach(async () => {
    _resetForTest();
    deps = makeFakeDeps();
    dir = await mkdtemp(path.join(tmpdir(), "airlock-devserver-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("agent start with no configured command runs the resolved guess", async () => {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );
    const r = await startDevServer(dir, "agent");
    expect(r.ok).toBe(true);
    expect(deps.starts).toEqual([
      { command: "npm run dev", startedBy: "agent" },
    ]);
    // Ephemeral: the agent guess is NOT persisted to project config.
    expect(existsSync(path.join(dir, ".airlock", "config.json"))).toBe(false);
  });

  it("agent start with no resolvable command returns needsCommand and runs nothing", async () => {
    // No package.json in the temp dir => resolveDevCommand returns null.
    const r = await startDevServer(dir, "agent");
    expect(r).toEqual({ ok: false, needsCommand: true, guess: null });
    expect(deps.starts).toEqual([]);
  });

  it("user start with no configured command returns needsCommand + guess (no auto-run)", async () => {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );
    const r = await startDevServer(dir, "user");
    expect(r).toEqual({
      ok: false,
      needsCommand: true,
      guess: "npm run dev",
    });
    expect(deps.starts).toEqual([]);
  });
});
