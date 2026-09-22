import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ONE RAIL, ONE CONTROL.
//
// Above the divider and below it are the same kind of thing -- an icon you
// click in the rail -- and they drifted apart twice: first the glyphs (14px
// below, 20px above), then the rhythm (a 2px pitch below, 40px above). Both
// times the bottom three read as a lesser class of control.
//
// The rhythm drifted because the footer was pinned to --sidebar-dock-h, a
// height it held so its top border would line up with the SIDEBAR quota
// meter's. That meter moved to the titlebar and the constraint outlived it.
// This asserts the two controls agree rather than describing them in a
// comment, which is what let the last arithmetic here go stale.
const css = readFileSync(join(__dirname, "theme.css"), "utf8");

function block(selector: string): string {
  const m = css.match(new RegExp(`^\\${selector} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1] as string;
}

function px(body: string, prop: string): number {
  const m = body.match(new RegExp(`[\\s;{]${prop}:\\s*(-?[\\d.]+)px`));
  if (!m) throw new Error(`no ${prop} in rule`);
  return Number(m[1]);
}

describe("activity bar footer", () => {
  it("is the same control as a section icon", () => {
    expect(px(block(".footer-btn"), "height")).toBe(
      px(block(".activity-icon"), "height"),
    );
    expect(px(block(".footer-btn .codicon"), "font-size")).toBe(
      px(
        block(".activity-icon .codicon,\n.activity-icon .brand-glyph"),
        "font-size",
      ),
    );
  });

  it("stacks at the same pitch, with no gap of its own", () => {
    // The rail's icons sit flush: their 40px box IS the rhythm. A gap here
    // would space the bottom three differently however tall they are.
    expect(block(".activity-bar-bottom")).not.toMatch(/[\s;{]gap:/);
  });

  it("insets its hover surface exactly as the rail does", () => {
    const inset = (body: string) =>
      body.match(/inset:\s*([^;]+);/)?.[1]?.trim();
    expect(inset(block(".footer-btn::after"))).toBe(
      inset(block(".activity-icon::after")),
    );
  });
});
