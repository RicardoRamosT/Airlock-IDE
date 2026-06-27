import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitted: Array<Record<string, unknown>> = [];
vi.mock("./wire", () => ({
  emitEvent: (e: Record<string, unknown>) => void emitted.push(e),
  flushEventLog: vi.fn(),
  startEventLog: vi.fn(),
}));

import { wrapIpcHandle } from "./capture";

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
