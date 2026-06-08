import { describe, expect, it } from "vitest";
import { toCmCompletions } from "./lspCompletions";

describe("toCmCompletions", () => {
  it("maps kind to CM type and uses insertText for apply", () => {
    const out = toCmCompletions([
      {
        label: "map",
        kind: 2,
        detail: "(method) map(): void",
        documentation: "doc",
        insertText: "map",
      },
      { label: "length", kind: 10 },
    ]);
    expect(out[0]).toEqual({
      label: "map",
      type: "method",
      detail: "(method) map(): void",
      info: "doc",
      apply: "map",
    });
    expect(out[1]).toEqual({
      label: "length",
      type: "property",
      detail: undefined,
      info: undefined,
      apply: "length",
    });
  });
  it("handles empty + unknown kind", () => {
    expect(toCmCompletions([])).toEqual([]);
    expect(toCmCompletions([{ label: "x", kind: 999 }])[0]?.type).toBe(
      "variable",
    );
  });
});
