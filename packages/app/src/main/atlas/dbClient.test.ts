import { expect, it, vi } from "vitest";
import { createDbClient, type HostProcess } from "./dbClient";
import type { DbRequest, DbResponse } from "./dbOps";

// A stand-in for the utilityProcess: records what was sent and lets a test
// answer, or die, on demand.
function fakeHost() {
  let onMessage: ((m: DbResponse) => void) | null = null;
  let onExit: ((code: number) => void) | null = null;
  const sent: DbRequest[] = [];
  let alive = true;
  const proc: HostProcess = {
    on: (_e, l) => {
      onMessage = l;
    },
    once: (_e, l) => {
      onExit = l;
    },
    postMessage: (m) => {
      if (!alive) throw new Error("channel closed");
      sent.push(m);
    },
  };
  return {
    proc,
    sent,
    reply: (value: unknown, i = sent.length - 1) =>
      onMessage?.({ id: sent[i]?.id as number, ok: true, value }),
    fail: (error: string, i = sent.length - 1) =>
      onMessage?.({ id: sent[i]?.id as number, ok: false, error }),
    // The abort: the host dies, taking every in-flight call with it.
    crash: (code = 134) => {
      alive = false;
      onExit?.(code);
    },
  };
}

it("resolves a call with the value the host sent back", async () => {
  const h = fakeHost();
  const db = createDbClient({ fork: () => h.proc });
  const p = db.lastBriefDay();
  expect(h.sent[0]?.op).toBe("lastBriefDay");
  h.reply("2026-08-30");
  expect(await p).toBe("2026-08-30");
});

it("passes arguments through and rejects when the host reports an error", async () => {
  const h = fakeHost();
  const db = createDbClient({ fork: () => h.proc });
  const p = db.readBrief("2026-08-30");
  expect(h.sent[0]?.args).toEqual(["2026-08-30"]);
  h.fail("disk is on fire");
  await expect(p).rejects.toThrow("disk is on fire");
});

it("turns a host CRASH into a rejected call, not a thrown app", async () => {
  // The whole reason this process exists. On 2026-08-30 a CHECK inside
  // node:sqlite's bind called abort() on the main process and took down every
  // window, terminal and running claude. abort() cannot be caught, so the only
  // defence is that it happens somewhere else -- and arrives here as this.
  const h = fakeHost();
  const db = createDbClient({ fork: () => h.proc });
  const a = db.readTurns(null, 10);
  const b = db.readFacts();
  h.crash(134);
  await expect(a).rejects.toThrow(/host exited \(134\)/);
  await expect(b).rejects.toThrow(/host exited \(134\)/);
});

it("starts a FRESH host on the next call after a crash", async () => {
  // A crash must not be terminal: Atlas loses one write, not the feature.
  const hosts = [fakeHost(), fakeHost()];
  let n = 0;
  const db = createDbClient({
    fork: () => (hosts[n++] as (typeof hosts)[0]).proc,
  });

  await expect(
    (() => {
      const p = db.readFacts();
      hosts[0]?.crash();
      return p;
    })(),
  ).rejects.toThrow(/host exited/);

  const p = db.lastBriefDay();
  expect(n).toBe(2); // respawned
  hosts[1]?.reply("2026-08-31");
  expect(await p).toBe("2026-08-31");
});

it("reuses one host across calls instead of forking per call", async () => {
  const h = fakeHost();
  const fork = vi.fn(() => h.proc);
  const db = createDbClient({ fork });
  const a = db.readFacts();
  const b = db.readAskedDay();
  expect(fork).toHaveBeenCalledTimes(1);
  h.reply([], 0);
  h.reply("2026-08-30", 1);
  await Promise.all([a, b]);
});

it("correlates concurrent calls by id, so replies cannot cross", async () => {
  const h = fakeHost();
  const db = createDbClient({ fork: () => h.proc });
  const first = db.readAskedDay();
  const second = db.lastBriefDay();
  // Answer them OUT OF ORDER: a slow read must not receive a fast read's value.
  h.reply("second-value", 1);
  h.reply("first-value", 0);
  expect(await first).toBe("first-value");
  expect(await second).toBe("second-value");
});

it("times out a wedged host rather than hanging Atlas forever", async () => {
  vi.useFakeTimers();
  try {
    const h = fakeHost();
    const db = createDbClient({ fork: () => h.proc, timeoutMs: 50 });
    const p = db.readFacts();
    const assertion = expect(p).rejects.toThrow(/timed out: readFacts/);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});

it("does not settle a call twice when a reply arrives after a crash", async () => {
  const h = fakeHost();
  const db = createDbClient({ fork: () => h.proc });
  const p = db.readFacts();
  h.crash();
  await expect(p).rejects.toThrow(/host exited/);
  // A late reply for the same id must be ignored, not throw.
  expect(() => h.reply([], 0)).not.toThrow();
});

it("rejects rather than throwing when the host cannot be started at all", async () => {
  const db = createDbClient({
    fork: () => {
      throw new Error("ENOENT");
    },
  });
  await expect(db.readFacts()).rejects.toThrow(/failed to start: ENOENT/);
});

it("exposes every store operation as a method", () => {
  // The client is generated from the op table, so this pins that the generation
  // actually happened rather than silently producing an empty object.
  const db = createDbClient({ fork: () => fakeHost().proc });
  for (const op of ["appendTurns", "readTurns", "saveBrief", "readSnapshot"]) {
    expect(typeof (db as unknown as Record<string, unknown>)[op]).toBe(
      "function",
    );
  }
});
