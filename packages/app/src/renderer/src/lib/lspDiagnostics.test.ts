import { describe, expect, it } from "vitest";
import { toCmDiagnostics } from "./lspDiagnostics";

const text = "const x = 1\nconsy y = 2\n";

describe("toCmDiagnostics", () => {
  it("maps line/char ranges to offsets and severities", () => {
    const out = toCmDiagnostics(text, [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 5 },
        },
        severity: 1,
        message: "Cannot find name 'consy'.",
      },
    ]);
    expect(out).toEqual([
      {
        from: 12,
        to: 17,
        severity: "error",
        message: "Cannot find name 'consy'.",
      },
    ]);
  });
  it("clamps out-of-range positions and handles empty", () => {
    expect(toCmDiagnostics(text, [])).toEqual([]);
    const out = toCmDiagnostics("abc", [
      {
        range: {
          start: { line: 9, character: 9 },
          end: { line: 9, character: 9 },
        },
        severity: 2,
        message: "x",
      },
    ]);
    expect(out[0]).toEqual({
      from: 3,
      to: 3,
      severity: "warning",
      message: "x",
    });
  });
});
