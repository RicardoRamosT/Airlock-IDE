import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { type IDisposable, type IPty, spawn } from "node-pty";

export type { IDisposable } from "node-pty";

export interface PtyOptions {
  shell?: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export class PtySession {
  readonly id: string = randomUUID();
  private readonly pty: IPty;

  constructor(opts: PtyOptions = {}) {
    this.pty = spawn(
      opts.shell ?? process.env.SHELL ?? "/bin/zsh",
      opts.args ?? [],
      {
        name: "xterm-256color",
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        cwd: opts.cwd ?? homedir(),
        env: { ...process.env, ...opts.env } as Record<string, string>,
      },
    );
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
