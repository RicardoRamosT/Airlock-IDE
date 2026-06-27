// packages/app/src/main/mcp/tools.events.test.ts
import { describe, expect, it, vi } from "vitest";

const calls: unknown[] = [];
vi.mock("../eventlog/wire", () => ({
  queryEvents: (f: unknown) => {
    calls.push(f);
    return Promise.resolve([
      { ts: "t", seq: 0, level: "error", category: "db", op: "db.ping" },
    ]);
  },
}));

import { eventsToolHandler } from "./tools";

describe("read_events tool handler", () => {
  it("passes the filter through and returns events as JSON text", async () => {
    const res = await eventsToolHandler({ level: "error", limit: 5 });
    expect(calls.at(-1)).toEqual({ level: "error", limit: 5 });
    const payload = JSON.parse(res.content[0]!.text) as Array<{ op: string }>;
    expect(payload[0]!.op).toBe("db.ping");
  });
});
