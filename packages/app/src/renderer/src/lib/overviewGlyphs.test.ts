import { describe, expect, it } from "vitest";
import type { TechCategory } from "../../../shared/ipc";
import { categoryGlyph } from "./overviewGlyphs";

const ALL: TechCategory[] = [
  "language",
  "runtime",
  "framework",
  "build",
  "packageManager",
  "orm",
  "database",
  "hosting",
  "backend",
  "auth",
  "payments",
  "infra",
  "observability",
  "other",
];

describe("categoryGlyph", () => {
  it("returns a non-empty codicon name for every category", () => {
    for (const c of ALL) expect(categoryGlyph(c)).toMatch(/^[a-z-]+$/);
  });
  it("maps recognizable categories to meaningful glyphs", () => {
    expect(categoryGlyph("database")).toBe("database");
    expect(categoryGlyph("hosting")).toBe("cloud");
    expect(categoryGlyph("auth")).toBe("shield");
    expect(categoryGlyph("language")).toBe("code");
  });
  it("falls back for 'other'", () => {
    expect(categoryGlyph("other")).toBe("circle-large-outline");
  });
});
