import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EslintPool, type WorkerProc } from "./pool";
import type { WorkerRequest } from "./protocol";

// A fake worker: records what main wrote, lets the test answer or exit.
interface Fake extends WorkerProc {
  unit: string;
  sent: WorkerRequest[];
  killed: boolean;
  answer(id: number, messages?: unknown[]): void;
  exit(): void;
}

let spawned: Fake[];
function spawner(unit: string): WorkerProc {
  let onLine: (l: string) => void = () => {};
  let onExit: () => void = () => {};
  const f: Fake = {
    unit,
    sent: [],
    killed: false,
    write: (line) => void f.sent.push(JSON.parse(line) as WorkerRequest),
    onLine: (cb) => void (onLine = cb),
    onExit: (cb) => void (onExit = cb),
    kill: () => {
      f.killed = true;
    },
    answer: (id, messages = []) => onLine(JSON.stringify({ id, messages })),
    exit: () => onExit(),
  };
  spawned.push(f);
  return f;
}

beforeEach(() => {
  spawned = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const pool = () =>
  new EslintPool(spawner, { timeoutMs: 10_000, idleMs: 300_000 });

describe("EslintPool", () => {
  it("spawns one worker per unit and reuses it (two files of one unit share it)", async () => {
    const p = pool();
    const a = p.lint("/p", "/p/a.ts", "1");
    const b = p.lint("/p", "/p/b.ts", "2");
    const c = p.lint("/p/client", "/p/client/c.ts", "3");
    expect(spawned.map((s) => s.unit)).toEqual(["/p", "/p/client"]);
    const [w, wc] = spawned;
    w?.answer(w.sent[0]?.id ?? -1);
    w?.answer(w.sent[1]?.id ?? -1);
    wc?.answer(wc.sent[0]?.id ?? -1);
    expect(await a).toEqual({ messages: [] });
    expect(await b).toEqual({ messages: [] });
    expect(await c).toEqual({ messages: [] });
  });

  it("routes each response to its request by id", async () => {
    const p = pool();
    const a = p.lint("/p", "/p/a.ts", "A");
    const b = p.lint("/p", "/p/b.ts", "B");
    const w = spawned[0];
    const idB = w?.sent.find((r) => r.text === "B")?.id ?? -1;
    w?.answer(idB, [{ ruleId: "x" }]);
    expect(await b).toEqual({ messages: [{ ruleId: "x" }] });
    w?.answer(w.sent.find((r) => r.text === "A")?.id ?? -1);
    expect(await a).toEqual({ messages: [] });
  });

  it("keeps ONE queued lint per file while one is in flight; newer replaces older", async () => {
    const p = pool();
    const first = p.lint("/p", "/p/a.ts", "v1");
    const second = p.lint("/p", "/p/a.ts", "v2");
    const third = p.lint("/p", "/p/a.ts", "v3");
    const w = spawned[0];
    expect(w?.sent.map((r) => r.text)).toEqual(["v1"]); // only one in flight
    expect(await second).toEqual({ superseded: true });
    w?.answer(w.sent[0]?.id ?? -1);
    expect(await first).toEqual({ messages: [] });
    expect(w?.sent.map((r) => r.text)).toEqual(["v1", "v3"]); // v2 never sent
    w?.answer(w.sent[1]?.id ?? -1);
    expect(await third).toEqual({ messages: [] });
  });

  it("times out a hung lint, kills the worker, and respawns on the next lint", async () => {
    const p = pool();
    const hung = p.lint("/p", "/p/a.ts", "x");
    vi.advanceTimersByTime(10_000);
    expect(await hung).toEqual({ timedOut: true });
    expect(spawned[0]?.killed).toBe(true);
    void p.lint("/p", "/p/a.ts", "y");
    expect(spawned).toHaveLength(2);
  });

  it("a crash fails what was in flight and respawns on demand", async () => {
    const p = pool();
    const inflight = p.lint("/p", "/p/a.ts", "x");
    spawned[0]?.exit();
    expect(await inflight).toEqual({ configError: "ESLint worker exited" });
    void p.lint("/p", "/p/a.ts", "y");
    expect(spawned).toHaveLength(2);
  });

  it("disposes a worker idle for idleMs, and respawns when needed again", async () => {
    const p = pool();
    const a = p.lint("/p", "/p/a.ts", "x");
    spawned[0]?.answer(spawned[0].sent[0]?.id ?? -1);
    await a;
    vi.advanceTimersByTime(299_999);
    expect(spawned[0]?.killed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(spawned[0]?.killed).toBe(true);
    void p.lint("/p", "/p/a.ts", "y");
    expect(spawned).toHaveLength(2);
  });

  it("does not idle out a worker that is still busy", () => {
    // Idle shorter than the timeout, so the idle timer really fires while the
    // lint is in flight.
    const p = new EslintPool(spawner, { timeoutMs: 600_000, idleMs: 1_000 });
    void p.lint("/p", "/p/a.ts", "x"); // never answered
    vi.advanceTimersByTime(5_000);
    expect(spawned[0]?.killed).toBe(false);
  });

  it("disposeUnder kills every unit inside a closed root, and only those", () => {
    const p = pool();
    void p.lint("/p/client", "/p/client/a.ts", "x");
    void p.lint("/p/server", "/p/server/a.ts", "x");
    void p.lint("/q", "/q/a.ts", "x");
    void p.lint("/p-old", "/p-old/a.ts", "x"); // prefix-sharing sibling, NOT inside /p
    p.disposeUnder("/p");
    expect(spawned.map((s) => [s.unit, s.killed])).toEqual([
      ["/p/client", true],
      ["/p/server", true],
      ["/q", false],
      ["/p-old", false],
    ]);
  });

  it("a late exit from a disposed worker does not disturb its replacement", async () => {
    const p = pool();
    void p.lint("/p", "/p/a.ts", "x");
    p.disposeUnit("/p");
    const next = p.lint("/p", "/p/a.ts", "y");
    spawned[0]?.exit(); // the OLD worker finally exits
    spawned[1]?.answer(spawned[1].sent[0]?.id ?? -1);
    expect(await next).toEqual({ messages: [] });
  });
});
