// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SectionGlyph } from "./SectionGlyph";

afterEach(cleanup);

const BRANDS = [
  "slack",
  "neon",
  "docker",
  "render",
  "snowflake",
  "azure",
  "vercel",
];

it("draws a monochrome brand mark for every extension brand", () => {
  for (const id of BRANDS) {
    const { container, unmount } = render(<SectionGlyph icon={id} />);
    const svg = container.querySelector("svg.brand-glyph");
    expect(svg, id).not.toBeNull();
    // currentColor is what makes it dim and brighten with the codicons beside
    // it instead of being a fixed-colour logo in a grey rail.
    expect(svg?.getAttribute("fill"), id).toBe("currentColor");
    expect(
      svg?.querySelector("path")?.getAttribute("d")?.length ?? 0,
    ).toBeGreaterThan(20);
    unmount();
  }
});

it("falls through to a codicon for a non-brand icon", () => {
  const { container } = render(<SectionGlyph icon="database" />);
  expect(container.querySelector("svg.brand-glyph")).toBeNull();
  expect(container.querySelector("i.codicon-database")).not.toBeNull();
});
