import { describe, expect, it } from "vitest";
import { digestSession, TAIL_CHARS, type TranscriptRecord } from "./sessions";

const SINCE = Date.UTC(2026, 8, 11, 0, 0, 0);
const UNTIL = Date.UTC(2026, 8, 12, 12, 0, 0);
const iso = (d: number) => new Date(d).toISOString();

const userMsg = (at: number, text: string): TranscriptRecord => ({
  type: "user",
  timestamp: iso(at),
  message: { role: "user", content: text },
});

const summary = (at: number, text: string): TranscriptRecord => ({
  type: "user",
  timestamp: iso(at),
  isCompactSummary: true,
  message: { role: "user", content: [{ type: "text", text }] },
});

describe("digestSession", () => {
  it("takes the title, the span and the message count", () => {
    const d = digestSession(
      "s1",
      [
        { type: "ai-title", aiTitle: "Monday data verification with prod" },
        userMsg(SINCE + 1000, "start"),
        userMsg(SINCE + 5000, "more"),
      ],
      SINCE,
      UNTIL,
    );
    expect(d?.title).toBe("Monday data verification with prod");
    expect(d?.userMessages).toBe(2);
    expect(d?.startedAt).toBe(SINCE + 1000);
    expect(d?.endedAt).toBe(SINCE + 5000);
  });

  it("keeps only compaction summaries written INSIDE the window", () => {
    // A summary from five days ago describes work from before the window. It
    // is both the most expensive thing in the prompt and the least correct.
    const d = digestSession(
      "s1",
      [
        summary(SINCE - 86_400_000 * 5, "old work"),
        summary(SINCE + 2000, "yesterday's work"),
        userMsg(SINCE + 3000, "hi"),
      ],
      SINCE,
      UNTIL,
    );
    expect(d?.compactSummaries).toEqual(["yesterday's work"]);
  });

  it("returns null for a session with no activity in the window", () => {
    const d = digestSession(
      "s1",
      [userMsg(SINCE - 99_999_999, "ancient")],
      SINCE,
      UNTIL,
    );
    expect(d).toBeNull();
  });

  it("survives a session with no ai-title", () => {
    const d = digestSession("s1", [userMsg(SINCE + 10, "x")], SINCE, UNTIL);
    expect(d?.title).toBeNull();
  });

  it("skips malformed records instead of throwing", () => {
    const d = digestSession(
      "s1",
      [
        { type: "user" },
        { timestamp: "not-a-date", type: "user" },
        null as unknown as TranscriptRecord,
        userMsg(SINCE + 10, "real"),
      ],
      SINCE,
      UNTIL,
    );
    expect(d?.userMessages).toBe(1);
  });

  it("bounds the tail", () => {
    const long = "x".repeat(TAIL_CHARS * 2);
    const d = digestSession("s1", [userMsg(SINCE + 10, long)], SINCE, UNTIL);
    expect((d?.tail ?? "").length).toBeLessThanOrEqual(TAIL_CHARS);
  });

  it("records the last prompt the user actually typed", () => {
    const d = digestSession(
      "s1",
      [userMsg(SINCE + 10, "first"), userMsg(SINCE + 20, "last thing I asked")],
      SINCE,
      UNTIL,
    );
    expect(d?.lastPrompt).toBe("last thing I asked");
  });
});
