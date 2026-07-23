import { describe, expect, it } from "vitest";
import {
  capEntries,
  MAX_DETAILS,
  parseJournalLine,
  readJournal,
  sanitizeNewEntry,
  serializeEntry,
} from "./journal";

describe("parseJournalLine", () => {
  it("parses a valid line; unknown tag -> note", () => {
    expect(parseJournalLine('{"ts":5,"tag":"change","text":"x"}')).toEqual({
      ts: 5,
      tag: "change",
      text: "x",
    });
    expect(parseJournalLine('{"ts":5,"tag":"weird","text":"x"}')?.tag).toBe(
      "note",
    );
  });
  it("returns null on garbage / missing / wrong-typed / empty", () => {
    expect(parseJournalLine("")).toBeNull();
    expect(parseJournalLine("not json")).toBeNull();
    expect(parseJournalLine('{"ts":0,"text":"x"}')).toBeNull();
    expect(parseJournalLine('{"ts":5,"text":""}')).toBeNull();
    expect(parseJournalLine('{"tag":"note","text":"x"}')).toBeNull();
  });
});

describe("sanitizeNewEntry", () => {
  it("builds an entry; unknown/absent tag -> note; trims", () => {
    expect(sanitizeNewEntry("hi", "fix", 9)).toEqual({
      ts: 9,
      tag: "fix",
      text: "hi",
    });
    expect(sanitizeNewEntry("  hi  ", undefined, 9)).toEqual({
      ts: 9,
      tag: "note",
      text: "hi",
    });
  });
  it("null on empty/oversize/non-string", () => {
    expect(sanitizeNewEntry("   ", "note", 9)).toBeNull();
    expect(sanitizeNewEntry("x".repeat(2001), "note", 9)).toBeNull();
    expect(sanitizeNewEntry(42, "note", 9)).toBeNull();
  });
});

describe("readJournal + capEntries + serialize", () => {
  it("reads multiple lines, drops bad ones", () => {
    const text =
      '{"ts":1,"tag":"note","text":"a"}\nbad\n{"ts":2,"tag":"fix","text":"b"}\n';
    expect(readJournal(text).map((e) => e.text)).toEqual(["a", "b"]);
  });
  it("capEntries keeps the last N", () => {
    const es = Array.from({ length: 5 }, (_, i) => ({
      ts: i + 1,
      tag: "note" as const,
      text: `${i}`,
    }));
    expect(capEntries(es, 2).map((e) => e.text)).toEqual(["3", "4"]);
  });
  it("serialize round-trips through parse", () => {
    const e = { ts: 7, tag: "decision" as const, text: "why" };
    expect(parseJournalLine(serializeEntry(e))).toEqual(e);
  });
});

describe("details field", () => {
  it("parses an entry WITH details and round-trips", () => {
    const line = serializeEntry({
      ts: 5,
      tag: "change",
      text: "t",
      details: "why\n- a",
    });
    expect(line).toContain('"details"');
    expect(parseJournalLine(line)).toEqual({
      ts: 5,
      tag: "change",
      text: "t",
      details: "why\n- a",
    });
  });
  it("omits details when absent (round-trip has no details key)", () => {
    const line = serializeEntry({ ts: 5, tag: "note", text: "t" });
    expect(line).not.toContain("details");
    expect(parseJournalLine(line)).toEqual({ ts: 5, tag: "note", text: "t" });
  });
  it("parse drops empty / non-string details", () => {
    expect(
      parseJournalLine('{"ts":5,"tag":"note","text":"t","details":""}'),
    ).toEqual({ ts: 5, tag: "note", text: "t" });
    expect(
      parseJournalLine('{"ts":5,"tag":"note","text":"t","details":42}'),
    ).toEqual({ ts: 5, tag: "note", text: "t" });
  });
  it("sanitizeNewEntry trims details, drops empty, clips to MAX_DETAILS", () => {
    expect(sanitizeNewEntry("t", "fix", 9, "  ctx  ")).toEqual({
      ts: 9,
      tag: "fix",
      text: "t",
      details: "ctx",
    });
    expect(sanitizeNewEntry("t", "fix", 9, "   ")).toEqual({
      ts: 9,
      tag: "fix",
      text: "t",
    });
    expect(
      sanitizeNewEntry("t", "note", 9, "x".repeat(MAX_DETAILS + 500))?.details
        ?.length,
    ).toBe(MAX_DETAILS);
  });
});
