import { describe, expect, it } from "vitest";
import { filterEvents, parseEventLog } from "./query";
import type { LogEvent } from "./types";

const evs: LogEvent[] = [
  {
    ts: "2026-01-01T00:00:01Z",
    seq: 0,
    level: "debug",
    category: "ipc",
    op: "ipc.git:status",
  },
  {
    ts: "2026-01-01T00:00:02Z",
    seq: 1,
    level: "error",
    category: "db",
    op: "db.ping",
    project: "/p",
  },
  {
    ts: "2026-01-01T00:00:03Z",
    seq: 2,
    level: "info",
    category: "db",
    op: "db.read",
    project: "/q",
  },
];

describe("filterEvents", () => {
  it("filters by minimum level", () => {
    expect(filterEvents(evs, { level: "info" }).map((e) => e.seq)).toEqual([
      1, 2,
    ]);
  });
  it("filters by category and op prefix", () => {
    expect(
      filterEvents(evs, { category: "db", op: "db.p" }).map((e) => e.seq),
    ).toEqual([1]);
  });
  it("filters by project and since", () => {
    expect(filterEvents(evs, { project: "/q" }).map((e) => e.seq)).toEqual([2]);
    expect(
      filterEvents(evs, { since: "2026-01-01T00:00:02Z" }).map((e) => e.seq),
    ).toEqual([1, 2]);
  });
  it("limit keeps the last N after filtering", () => {
    expect(filterEvents(evs, { limit: 2 }).map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe("parseEventLog", () => {
  it("parses JSONL and skips corrupt lines", () => {
    const text = `${JSON.stringify(evs[0])}\nnot json\n${JSON.stringify(evs[1])}\n`;
    expect(parseEventLog(text).map((e) => e.seq)).toEqual([0, 1]);
  });
});
