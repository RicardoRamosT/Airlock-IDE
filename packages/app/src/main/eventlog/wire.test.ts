import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/unused" } }));

import {
  __setLogFileForTest,
  emitEvent,
  flushEventLog,
  queryEvents,
  startEventLog,
  stopEventLog,
} from "./wire";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "evtwire-"));
  __setLogFileForTest(path.join(dir, "log.jsonl"));
});
afterEach(async () => {
  stopEventLog();
  await rm(dir, { recursive: true, force: true });
});

describe("event log wire", () => {
  it("emits, flushes, and queries events back", async () => {
    startEventLog({ enabled: true, minLevel: "debug" });
    emitEvent({ level: "info", category: "test", op: "alpha" });
    emitEvent({ level: "error", category: "test", op: "beta" });
    await flushEventLog();
    const all = await queryEvents({});
    expect(all.map((e) => e.op)).toEqual(["alpha", "beta"]);
    expect(await queryEvents({ level: "error" })).toHaveLength(1);
  });

  it("drops events below minLevel", async () => {
    startEventLog({ enabled: true, minLevel: "warn" });
    emitEvent({ level: "info", category: "test", op: "skip" });
    emitEvent({ level: "error", category: "test", op: "keep" });
    await flushEventLog();
    expect((await queryEvents({})).map((e) => e.op)).toEqual(["keep"]);
  });

  it("is a no-op when disabled (emit does nothing, query is empty)", async () => {
    startEventLog({ enabled: false, minLevel: "debug" });
    emitEvent({ level: "error", category: "test", op: "nope" });
    await flushEventLog();
    expect(await queryEvents({})).toEqual([]);
  });
});
