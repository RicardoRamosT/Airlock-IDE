import { describe, expect, it, vi } from "vitest";
import { writeVerified } from "./verifyWrite";

describe("writeVerified", () => {
  it("accepts a write that stored what it was given", () => {
    const read = vi.fn(() => "hello");
    const run = vi.fn();
    writeVerified("brief", "hello", run, read);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries once when the value comes back short, and accepts the retry", () => {
    // The observed failure: a value is written and stored TRUNCATED, with no
    // error anywhere. Six of eighteen Atlas snapshots were unparseable and two
    // debriefs ended mid-word before anyone noticed, because every reader
    // swallowed the parse failure.
    let attempt = 0;
    const run = vi.fn(() => {
      attempt += 1;
    });
    const read = vi.fn(() => (attempt === 1 ? "hel" : "hello"));
    writeVerified("brief", "hello", run, read);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("throws rather than silently keeping a short value", () => {
    const run = vi.fn();
    const read = vi.fn(() => "hel");
    expect(() => writeVerified("brief", "hello", run, read)).toThrow(/brief/);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("names the sizes, so the next occurrence is diagnosable", () => {
    expect(() =>
      writeVerified("standup", "abcdefghij", vi.fn(), () => "abc"),
    ).toThrow(/3 of 10/);
  });

  it("treats a missing row as a failed write", () => {
    expect(() => writeVerified("snapshot", "abc", vi.fn(), () => null)).toThrow(
      /0 of 3/,
    );
  });

  it("does not compare when there is nothing to compare", () => {
    // An empty value is bound as a plain string, not bytes; nothing to verify.
    const run = vi.fn();
    const read = vi.fn();
    writeVerified("brief", "", run, read);
    expect(run).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });
});
