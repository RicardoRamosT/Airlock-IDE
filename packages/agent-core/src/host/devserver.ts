// Pure dev-server logic for the managed Host dev server. No Electron, no I/O:
// command resolution, subtree-port selection, and the lifecycle state machine
// live here so they are unit-testable; the main process supplies the pty,
// lsof/ps output, and broadcasts.

export type DevServerStatus = "idle" | "starting" | "running" | "exited";

export interface DevServerState {
  status: DevServerStatus;
  url: string | null; // http://localhost:<port> once the port is discovered
  port: number | null;
  terminalId: string | null; // the dedicated dev terminal (focusable for logs)
  command: string | null; // the command actually run
  startedBy: "user" | "agent" | null;
  exitCode: number | null; // set when status === "exited"
}

export const IDLE_DEV_SERVER: DevServerState = {
  status: "idle",
  url: null,
  port: null,
  terminalId: null,
  command: null,
  startedBy: null,
  exitCode: null,
};

export type DevServerEvent =
  | {
      type: "start";
      command: string;
      terminalId: string;
      startedBy: "user" | "agent";
    }
  | { type: "port"; port: number }
  | { type: "exit"; code: number | null }
  | { type: "stop" };

// Package manager by lockfile, checked in priority order; npm is the default.
const PM_BY_LOCKFILE: ReadonlyArray<readonly [string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

// The human-blessed dev command: an explicit cfg.devCommand wins; otherwise
// guess `<pm> run <dev|start>` from package.json scripts + the lockfile. Returns
// null when nothing is derivable (caller then asks the human to set one).
export function resolveDevCommand(
  cfg: { devCommand?: string },
  pkgJson: string | null,
  lockfiles: string[],
): string | null {
  const configured = cfg.devCommand?.trim();
  if (configured) return configured;
  if (!pkgJson) return null;
  let scripts: Record<string, string> = {};
  try {
    const parsed = JSON.parse(pkgJson) as { scripts?: Record<string, string> };
    scripts = parsed.scripts ?? {};
  } catch {
    return null;
  }
  const script = scripts.dev ? "dev" : scripts.start ? "start" : null;
  if (!script) return null;
  const pm = PM_BY_LOCKFILE.find(([f]) => lockfiles.includes(f))?.[1] ?? "npm";
  return `${pm} run ${script}`;
}

// The first listening port owned by a process in the managed server's own
// subtree. Ports owned by any other PID (e.g. another project's dev server on
// the same default port) are ignored -- this is what prevents cross-project
// false positives.
export function pickListeningPortFromSubtree(
  ports: Array<{ pid: number; port: number }>,
  subtreePids: Set<number>,
): number | null {
  for (const { pid, port } of ports) {
    if (subtreePids.has(pid)) return port;
  }
  return null;
}

// Lifecycle FSM. start is idempotent while active; port only advances from
// starting/running; exit records the code (keeping url for display); stop
// resets to idle.
export function devServerNextState(
  state: DevServerState,
  event: DevServerEvent,
): DevServerState {
  switch (event.type) {
    case "start":
      if (state.status === "starting" || state.status === "running")
        return state;
      return {
        status: "starting",
        url: null,
        port: null,
        terminalId: event.terminalId,
        command: event.command,
        startedBy: event.startedBy,
        exitCode: null,
      };
    case "port":
      if (state.status !== "starting" && state.status !== "running")
        return state;
      return {
        ...state,
        status: "running",
        port: event.port,
        url: `http://localhost:${event.port}`,
      };
    case "exit":
      if (state.status === "idle") return state;
      return { ...state, status: "exited", exitCode: event.code };
    case "stop":
      return { ...IDLE_DEV_SERVER };
  }
}
