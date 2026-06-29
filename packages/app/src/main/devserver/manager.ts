import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type DevServerEvent,
  type DevServerState,
  devServerNextState,
  IDLE_DEV_SERVER,
  pickListeningPortFromSubtree,
  pickUnmanagedServer,
  readProjectConfig,
  resolveDevCommand,
  writeProjectConfig,
} from "@airlock/agent-core";
import type { DevServerStartResult } from "../../shared/ipc";
import { listeningPorts, subtreePids } from "./discover";

// Dependency seam: injected for production, overridable in tests so the
// container is unit-testable without pulling electron into vitest.
export interface ManagerDeps {
  broadcast: (root: string, state: DevServerState) => void;
  writeInput: (ptyId: string, data: string) => boolean;
  runStart: (command: string, startedBy: "user" | "agent") => Promise<void>;
}

// Real production deps (lazy-loaded to keep electron out of the module
// top-level so vitest can import this file without mocking electron).
function makeRealDeps(): ManagerDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BrowserWindow } = require("electron") as typeof import("electron");
  const { writeTerminalInput } = require("../ipc") as typeof import("../ipc");
  const { runAgentCommand } =
    require("../agent-commands") as typeof import("../agent-commands");
  return {
    broadcast(root, state) {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.webContents.isDestroyed())
          w.webContents.send("devserver:changed", { root, state });
      }
    },
    writeInput: writeTerminalInput,
    async runStart(command, startedBy) {
      await runAgentCommand({ type: "start_dev_server", command, startedBy });
    },
  };
}

// Singleton deps: created lazily so tests can inject before first use.
let _deps: ManagerDeps | null = null;

// Override deps (used by tests; must be called before any manager function).
export function _setDepsForTest(d: ManagerDeps): void {
  _deps = d;
}

// Reset module state between tests (clear states, rootToPty, pollTimers, and deps).
export function _resetForTest(): void {
  for (const t of pollTimers.values()) clearInterval(t);
  pollTimers.clear();
  states.clear();
  rootToPty.clear();
  _deps = null;
}

function getDeps(): ManagerDeps {
  if (!_deps) _deps = makeRealDeps();
  return _deps;
}

// ----------------------------------------------------------------------------
// State stores

const states = new Map<string, DevServerState>(); // root -> state
const rootToPty = new Map<string, string>(); // root -> managed ptyId
const pollTimers = new Map<string, ReturnType<typeof setInterval>>(); // root -> poll timer

function get(root: string): DevServerState {
  return states.get(root) ?? IDLE_DEV_SERVER;
}

function apply(root: string, event: DevServerEvent): DevServerState {
  const next = devServerNextState(get(root), event);
  states.set(root, next);
  getDeps().broadcast(root, next);
  return next;
}

// ----------------------------------------------------------------------------
// Port discovery

const DISCOVER_MS = 1000;

function startPortDiscovery(root: string, ptyId: string): void {
  stopPortDiscovery(root);
  const tick = () => {
    // Lazy-require keeps electron out of the module top-level (same pattern as
    // writeTerminalInput above) so vitest can import this file without mocking.
    const { ptyPid } = require("../ipc") as typeof import("../ipc");
    const pid = ptyPid(ptyId);
    if (pid === null) return; // pty gone; onPtyExit handles the reset
    const pids = subtreePids(pid);
    const port = pickListeningPortFromSubtree(listeningPorts(), pids);
    const state = get(root);
    if (port !== null && state.port !== port) {
      apply(root, { type: "port", port });
    } else if (state.status === "running" && port === null && pids.size <= 1) {
      // Liveness: once running, a vanished server child (no descendants beyond
      // the shell) AND no port -> dev server stopped (Ctrl-C/crash) while the
      // shell survives. Move to exited so Host offers Restart.
      apply(root, { type: "exit", code: null });
      stopPortDiscovery(root);
    }
  };
  pollTimers.set(root, setInterval(tick, DISCOVER_MS));
}

function stopPortDiscovery(root: string): void {
  const t = pollTimers.get(root);
  if (t !== undefined) {
    clearInterval(t);
    pollTimers.delete(root);
  }
}

// ----------------------------------------------------------------------------
// Public API

export function getDevServerState(root: string): DevServerState {
  return get(root);
}

export function devServerPtyId(root: string): string | null {
  return rootToPty.get(root) ?? null;
}

// Detect an UNMANAGED dev server attributable to this project: a LISTEN port
// owned by a process in one of THIS project's AirLock terminals, excluding the
// managed pty. Value-free ({ port, owning ptyId }); null when none. Because it
// only inspects this project's terminal subtrees, it never reports another
// project's — or AirLock's own — server (no cross-project false positive).
export function detectUnmanaged(
  root: string,
): { port: number; ptyId: string } | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { terminalPidsForRoot } = require("../ipc") as typeof import("../ipc"); // lazy-require: keep electron/ipc out of the module top-level (same pattern as the poll's ptyPid)
  const managed = rootToPty.get(root) ?? null;
  const terminals = terminalPidsForRoot(root)
    .filter((t) => t.ptyId !== managed)
    .map((t) => ({ ptyId: t.ptyId, pids: subtreePids(t.pid) }));
  return pickUnmanagedServer(terminals, listeningPorts());
}

// Resolve the dev command for a root: explicit cfg.devCommand, else a guess
// from package.json + lockfile (resolveDevCommand is pure; this is the I/O
// wrapper).
async function resolveCommand(root: string): Promise<string | null> {
  const cfg = await readProjectConfig(root);
  let pkgJson: string | null = null;
  try {
    pkgJson = await readFile(path.join(root, "package.json"), "utf8");
  } catch {
    pkgJson = null;
  }
  const lockfiles = [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
  ].filter((f) => existsSync(path.join(root, f)));
  return resolveDevCommand(cfg, pkgJson, lockfiles);
}

// Start: only a CONFIGURED cfg.devCommand runs. An unset command yields a
// needs-command result carrying the guess (the UI confirms+persists it; the
// agent surfaces it). Idempotent while active.
export async function startDevServer(
  root: string,
  startedBy: "user" | "agent",
): Promise<DevServerStartResult> {
  const cur = get(root);
  if (cur.status === "starting" || cur.status === "running")
    return { ok: true, state: cur };
  const cfg = await readProjectConfig(root);
  const command = cfg.devCommand?.trim() ?? null;
  if (!command)
    return { ok: false, needsCommand: true, guess: await resolveCommand(root) };
  // Ask the renderer to open a dev terminal + run the command; it calls
  // registerDevServer once the pty adopts (so state is 'starting' by return).
  await getDeps().runStart(command, startedBy);
  return { ok: true, state: get(root) };
}

// Persist a chosen/confirmed command, then start (the UI confirm path).
export async function setDevServerCommand(
  root: string,
  command: string,
): Promise<DevServerStartResult> {
  const trimmed = command.trim();
  if (!trimmed)
    return { ok: false, needsCommand: true, guess: await resolveCommand(root) };
  await writeProjectConfig(root, { devCommand: trimmed });
  return startDevServer(root, "user");
}

// The renderer reports the adopted dev terminal: record it and move to
// 'starting'.
export function registerDevServer(
  root: string,
  terminalId: string,
  ptyId: string,
  command: string,
  startedBy: "user" | "agent",
): DevServerState {
  const cur = get(root);
  if (cur.status === "starting" || cur.status === "running") return cur;
  rootToPty.set(root, ptyId);
  const state = apply(root, { type: "start", command, terminalId, startedBy });
  startPortDiscovery(root, ptyId);
  return state;
}

// Stop: Ctrl-C the foreground dev server (the shell/terminal survives so logs
// persist), then reset to idle.
export function stopDevServer(root: string): DevServerState {
  const ptyId = rootToPty.get(root);
  if (ptyId) getDeps().writeInput(ptyId, "\x03"); // SIGINT to foreground group
  rootToPty.delete(root);
  stopPortDiscovery(root);
  return apply(root, { type: "stop" });
}

// A managed dev terminal's pty exited (terminal closed): reset that root.
export function onPtyExitForDevServer(ptyId: string): void {
  for (const [root, id] of rootToPty) {
    if (id === ptyId) {
      rootToPty.delete(root);
      stopPortDiscovery(root);
      apply(root, { type: "exit", code: null });
      return;
    }
  }
}
