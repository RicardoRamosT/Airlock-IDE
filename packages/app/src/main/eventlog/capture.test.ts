import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitted: Array<Record<string, unknown>> = [];
vi.mock("./wire", () => ({
  emitEvent: (e: Record<string, unknown>) => void emitted.push(e),
  flushEventLog: vi.fn(),
  startEventLog: vi.fn(),
}));

import { installConsoleFunnel, wrapIpcHandle } from "./capture";

function fakeIpcMain() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  return {
    handle(ch: string, fn: (...a: unknown[]) => unknown) {
      handlers.set(ch, fn);
    },
    invoke: (ch: string, ...a: unknown[]) => handlers.get(ch)?.(...a),
  };
}

beforeEach(() => {
  emitted.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("wrapIpcHandle", () => {
  it("logs a successful handler with ok outcome", async () => {
    const ipc = fakeIpcMain();
    wrapIpcHandle(ipc as never);
    ipc.handle("git:status", async () => "ok");
    await ipc.invoke("git:status", {}, "/root");
    const rec = emitted.find((e) => e.op === "ipc.git:status");
    expect(rec).toMatchObject({
      category: "ipc",
      outcome: "ok",
      level: "debug",
    });
    expect(typeof rec?.durationMs).toBe("number");
  });

  it("logs a throwing handler as an error event and re-throws", async () => {
    const ipc = fakeIpcMain();
    wrapIpcHandle(ipc as never);
    ipc.handle("boom", async () => {
      throw new Error("nope");
    });
    await expect(ipc.invoke("boom", {})).rejects.toThrow("nope");
    const rec = emitted.find((e) => e.op === "ipc.boom");
    expect(rec).toMatchObject({
      category: "ipc",
      outcome: "error",
      level: "error",
    });
  });
});

describe("installConsoleFunnel", () => {
  it('records an Error\'s MESSAGE and STACK, not "{}"', () => {
    // The bug this pins: stringifyArg used JSON.stringify, and an Error has no
    // enumerable own properties, so every console.error("msg", err) in main
    // logged the literal text "{}". It produced 106 identical
    // "[fsWatch] watch error for <root>: {}" entries over five days -- the one
    // recurring failure in normal use, recorded in a form nobody can act on.
    const orig = console.error;
    try {
      installConsoleFunnel();
      console.error("[fsWatch] watch error for /p/a:", new Error("EMFILE"));
    } finally {
      console.error = orig;
    }
    const rec = emitted.find((e) => e.op === "console.error");
    const msg = String(
      (rec?.detail as { message?: string } | undefined)?.message ?? "",
    );
    expect(msg).toContain("EMFILE");
    expect(msg).not.toContain("{}");
  });

  it("keeps plain objects readable, and never throws on a circular one", () => {
    const orig = console.error;
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    try {
      installConsoleFunnel();
      console.error("plain", { port: 4319 });
      console.error("circular", circular);
    } finally {
      console.error = orig;
    }
    const msgs = emitted
      .filter((e) => e.op === "console.error")
      .map((e) => String((e.detail as { message?: string }).message ?? ""));
    expect(msgs[0]).toContain("4319");
    expect(msgs[1]).toContain("circular");
  });
});
