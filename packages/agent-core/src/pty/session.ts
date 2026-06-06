import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { type IDisposable, type IPty, spawn } from "node-pty";
import { loginShell } from "./login-env";

export type { IDisposable } from "node-pty";

export interface PtyOptions {
  shell?: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
  // Per-call env (e.g. injected secrets). Layered ON TOP of baseEnv.
  env?: Record<string, string>;
  // Captured login-shell env (homebrew PATH, locale). Layered over
  // process.env as the base for the child; per-call env still wins.
  baseEnv?: Record<string, string>;
  // Enable node-pty flow control so the child is paused under buffer
  // backpressure (XOFF/XON markers). Defaults to true.
  handleFlowControl?: boolean;
}

export class PtySession {
  readonly id: string = randomUUID();
  // Underlying child process pid (node-pty IPty.pid). Exposed so the main
  // process can ask whether the shell has a running child (pty:isBusy ->
  // pgrep -P <pid>); never used to signal/kill the process here. ASCII-only:
  // this module is CJS-bundled into Electron main.
  readonly pid: number;
  private readonly pty: IPty;

  constructor(opts: PtyOptions = {}) {
    // Env precedence (low to high): process.env floor, then the captured
    // login-shell env (real PATH/locale), then per-call env (injected
    // secrets). TERM_PROGRAM is forced last so terminals identify as Airlock.
    const env = {
      ...process.env,
      ...opts.baseEnv,
      ...opts.env,
    } as Record<string, string>;
    env.TERM_PROGRAM = "Airlock";
    this.pty = spawn(opts.shell ?? loginShell(), opts.args ?? [], {
      name: "xterm-256color",
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd ?? homedir(),
      env,
      // Apply backpressure: node-pty pauses the child when the consumer
      // falls behind, so a flood (e.g. cat-ing a huge file) cannot run the
      // main process unbounded. Default markers are XOFF/XON, which do not
      // appear in normal program output.
      handleFlowControl: opts.handleFlowControl ?? true,
    });
    this.pid = this.pty.pid;
  }

  onData(cb: (data: string) => void): IDisposable {
    return this.pty.onData(cb);
  }

  onExit(cb: (exitCode: number) => void): IDisposable {
    return this.pty.onExit(({ exitCode }) => cb(exitCode));
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(): void {
    this.pty.kill();
  }
}

export function createPtySession(opts: PtyOptions = {}): PtySession {
  return new PtySession(opts);
}
