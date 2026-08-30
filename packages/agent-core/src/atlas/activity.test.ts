import { expect, it } from "vitest";
import { COMMIT_LOG_FORMAT, parseCommitLog } from "./activity";

// Unit separator between fields, record separator between commits. Written as
// escapes, never as literal control characters, so the source stays readable.
const US = "\x1f";
const RS = "\x1e";

it("uses separators that a commit subject cannot contain", () => {
  expect(COMMIT_LOG_FORMAT).toBe(`%H${US}%ct${US}%s${RS}`);
});

it("parses one commit into hash, epoch ms, and subject", () => {
  const raw = `abc123${US}1756512000${US}fix: the calendar${RS}`;
  expect(parseCommitLog(raw)).toEqual([
    { hash: "abc123", at: 1756512000000, subject: "fix: the calendar" },
  ]);
});

it("parses several commits and preserves git's order", () => {
  const raw =
    `aaa${US}1756512000${US}first${RS}` + `bbb${US}1756511000${US}second${RS}`;
  expect(parseCommitLog(raw).map((c) => c.hash)).toEqual(["aaa", "bbb"]);
});

it("keeps a subject that contains a newline intact", () => {
  const raw = `aaa${US}1756512000${US}line one\nline two${RS}`;
  expect(parseCommitLog(raw)[0]?.subject).toBe("line one\nline two");
});

it("returns an empty list for empty output, which is a normal quiet day", () => {
  expect(parseCommitLog("")).toEqual([]);
  expect(parseCommitLog("\n")).toEqual([]);
});

it("skips a malformed record rather than throwing", () => {
  const raw = `broken${RS}` + `aaa${US}1756512000${US}ok${RS}`;
  expect(parseCommitLog(raw).map((c) => c.hash)).toEqual(["aaa"]);
});

it("skips a record whose timestamp is not a number", () => {
  const raw = `aaa${US}notatime${US}ok${RS}`;
  expect(parseCommitLog(raw)).toEqual([]);
});
