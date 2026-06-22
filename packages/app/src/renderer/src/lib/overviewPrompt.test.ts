import { describe, expect, it } from "vitest";
import { buildOverviewPrompt } from "./overviewPrompt";

describe("buildOverviewPrompt", () => {
  it("is a single line (no embedded newline — would submit early in Claude's TUI)", () => {
    const p = buildOverviewPrompt(["packages/app", "packages/agent-core"]);
    expect(p).not.toContain("\n");
  });
  it("names the output file and asks for markdown structure", () => {
    const p = buildOverviewPrompt(["docs"]);
    expect(p).toContain(".airlock/overview.md");
    expect(p).toMatch(/markdown/i);
    expect(p).toMatch(/## /); // asks for per-area headings
  });
  it("seeds the areas to cover", () => {
    expect(buildOverviewPrompt(["a", "b"])).toContain("Areas to cover: a, b.");
  });
  it("falls back when no areas are given", () => {
    expect(buildOverviewPrompt([])).toContain("(infer from the tree)");
  });
  it("instructs Claude not to leak secrets/credentials into the file", () => {
    const p = buildOverviewPrompt(["packages/app"]);
    expect(p).toMatch(/never include secret/i);
    expect(p).toMatch(/credential|token|connection string/i);
    expect(p).not.toContain("\n"); // still single-line after the directive
  });
});
