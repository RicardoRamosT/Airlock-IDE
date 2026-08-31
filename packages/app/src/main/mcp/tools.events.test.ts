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

import {
  EVENTS_DEFAULT_LIMIT,
  EVENTS_MAX_LIMIT,
  eventsToolHandler,
} from "./tools";

describe("read_events tool handler", () => {
  it("passes the filter through and returns events as JSON text", async () => {
    const res = await eventsToolHandler({ level: "error", limit: 5 });
    expect(calls.at(-1)).toEqual({ level: "error", limit: 5 });
    const payload = JSON.parse(res.content[0].text) as Array<{ op: string }>;
    expect(payload[0]?.op).toBe("db.ping");
  });
});

it("asks for a BOUNDED page even when the caller gives no limit", async () => {
  // A tool result goes straight into the model's context, and filterEvents
  // applies no cap when limit is absent -- so read_events with no arguments
  // pulled the ENTIRE event log (5.5MB in one real install) through the MCP
  // transport and into the conversation.
  calls.length = 0;
  await eventsToolHandler({});
  expect((calls[0] as { limit?: number }).limit).toBe(EVENTS_DEFAULT_LIMIT);
});

it("clamps an absurd explicit limit to the ceiling", async () => {
  calls.length = 0;
  await eventsToolHandler({ limit: 1_000_000 });
  expect((calls[0] as { limit?: number }).limit).toBe(EVENTS_MAX_LIMIT);
});

it("honours a sensible explicit limit unchanged", async () => {
  calls.length = 0;
  await eventsToolHandler({ limit: 25 });
  expect((calls[0] as { limit?: number }).limit).toBe(25);
});
