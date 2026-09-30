// pool.ts -- one warm ESLint worker per trusted unit, electron-free.
//
// The spawner is injected, so every lifecycle rule here is unit-tested without
// a real process: lazy spawn, one queued lint per file (typing never piles up
// work), a request timeout (a hung config must not freeze the marks forever),
// idle disposal (a worker costs memory and battery), and crash reaping (the
// PB-H10 rule the LSP client follows: a dead worker is dropped and the next
// lint respawns, never handed back).
//
// Trust is NOT checked here -- the service does that on every call before it
// reaches the pool. The pool only ever runs what it is asked to.
import path from "node:path";
import type { EslintMessage, WorkerRequest } from "./protocol";

function isInside(p: string, root: string): boolean {
  return p === root || p.startsWith(root + path.sep);
}

export interface WorkerProc {
  write(line: string): void;
  onLine(cb: (line: string) => void): void;
  onExit(cb: () => void): void;
  kill(): void;
}
export type Spawner = (unitAbs: string) => WorkerProc;

export type LintOutcome =
  | { messages: EslintMessage[] }
  | { configError: string }
  | { timedOut: true }
  | { superseded: true };

type Resolve = (o: LintOutcome) => void;

interface Worker {
  unit: string;
  proc: WorkerProc;
  nextId: number;
  inflight: Map<number, { file: string; resolve: Resolve; timer: Timer }>;
  busy: Set<string>; // files with a lint in flight
  queued: Map<string, { text: string; resolve: Resolve }>;
  idle?: Timer;
}
type Timer = ReturnType<typeof setTimeout>;

export class EslintPool {
  private readonly workers = new Map<string, Worker>();
  private readonly timeoutMs: number;
  private readonly idleMs: number;

  constructor(
    private readonly spawn: Spawner,
    opts: { timeoutMs?: number; idleMs?: number } = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.idleMs = opts.idleMs ?? 5 * 60_000;
  }

  lint(unitAbs: string, fileAbs: string, text: string): Promise<LintOutcome> {
    const w = this.ensure(unitAbs);
    return new Promise<LintOutcome>((resolve) => {
      if (w.busy.has(fileAbs)) {
        // Only the newest text matters: the one it replaces will never be sent.
        w.queued.get(fileAbs)?.resolve({ superseded: true });
        w.queued.set(fileAbs, { text, resolve });
        return;
      }
      this.send(w, fileAbs, text, resolve);
    });
  }

  disposeUnit(unitAbs: string): void {
    const w = this.workers.get(unitAbs);
    if (w) this.teardown(w, "ESLint was turned off", true);
  }

  // Every unit INSIDE a closed project -- segment-wise, so closing /p never
  // touches a sibling /p-old.
  disposeUnder(rootAbs: string): void {
    for (const w of [...this.workers.values()])
      if (isInside(w.unit, rootAbs)) this.teardown(w, "Project closed", true);
  }

  // Keep only units inside a still-open project. Called with the full open-root
  // set at the same moments as syncLspServers (a window closes, a tab closes).
  retainOnly(openRoots: string[]): void {
    for (const w of [...this.workers.values()])
      if (!openRoots.some((r) => isInside(w.unit, r)))
        this.teardown(w, "Project closed", true);
  }

  disposeAll(): void {
    for (const w of [...this.workers.values()])
      this.teardown(w, "AirLock is quitting", true);
  }

  private ensure(unit: string): Worker {
    const existing = this.workers.get(unit);
    if (existing) return existing;
    const proc = this.spawn(unit);
    const w: Worker = {
      unit,
      proc,
      nextId: 0,
      inflight: new Map(),
      busy: new Set(),
      queued: new Map(),
    };
    proc.onLine((line) => this.onLine(w, line));
    // A disposed worker's late exit must not touch its replacement: teardown
    // checks that `w` is still the registered worker for the unit.
    proc.onExit(() => this.teardown(w, "ESLint worker exited", false));
    this.workers.set(unit, w);
    return w;
  }

  private send(w: Worker, file: string, text: string, resolve: Resolve): void {
    const id = ++w.nextId;
    w.busy.add(file);
    const timer = setTimeout(() => {
      w.inflight.delete(id);
      resolve({ timedOut: true });
      this.teardown(w, "ESLint timed out", true);
    }, this.timeoutMs);
    w.inflight.set(id, { file, resolve, timer });
    const req: WorkerRequest = { id, op: "lint", filePath: file, text };
    w.proc.write(`${JSON.stringify(req)}\n`);
    this.armIdle(w);
  }

  private onLine(w: Worker, line: string): void {
    let msg: { id?: unknown; messages?: unknown; configError?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not ours (a plugin printing to stdout); ignore
    }
    const entry =
      typeof msg.id === "number" ? w.inflight.get(msg.id) : undefined;
    if (!entry || typeof msg.id !== "number") return;
    clearTimeout(entry.timer);
    w.inflight.delete(msg.id);
    w.busy.delete(entry.file);
    entry.resolve(
      typeof msg.configError === "string"
        ? { configError: msg.configError }
        : { messages: Array.isArray(msg.messages) ? msg.messages : [] },
    );
    const next = w.queued.get(entry.file);
    if (next) {
      w.queued.delete(entry.file);
      this.send(w, entry.file, next.text, next.resolve);
    }
  }

  private armIdle(w: Worker): void {
    if (w.idle) clearTimeout(w.idle);
    w.idle = setTimeout(() => {
      if (w.inflight.size > 0) this.armIdle(w);
      else this.teardown(w, "ESLint idle", true);
    }, this.idleMs);
  }

  // Drop the worker and answer everything still waiting on it, so no editor is
  // left holding a promise that never settles.
  private teardown(w: Worker, reason: string, kill: boolean): void {
    if (this.workers.get(w.unit) !== w) return; // already replaced or gone
    this.workers.delete(w.unit);
    if (w.idle) clearTimeout(w.idle);
    for (const e of w.inflight.values()) {
      clearTimeout(e.timer);
      e.resolve({ configError: reason });
    }
    for (const q of w.queued.values()) q.resolve({ configError: reason });
    w.inflight.clear();
    w.queued.clear();
    w.busy.clear();
    if (kill) w.proc.kill();
  }
}
