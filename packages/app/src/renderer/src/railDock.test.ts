import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The rail's footer (feedback / accounts / settings) has to fit EXACTLY inside
// --sidebar-dock-h. If the three buttons come to more than that, the dock
// grows, and the activity bar's divider stops lining up with the quota meter's
// -- a misalignment two rules apart in this file, in a sum nothing computes.
//
// The arithmetic is written in a comment beside .footer-btn's height, which is
// how it survived the glyphs going from 14px to 20px: the comment still said
// 3*22 while the box said 24. This asserts the sum instead of describing it.
const css = readFileSync(join(__dirname, "theme.css"), "utf8");

function block(selector: string): string {
  const re = new RegExp(`^\\${selector} \\{([\\s\\S]*?)^\\}`, "m");
  const m = css.match(re);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1] as string;
}

function px(body: string, prop: string): number {
  // No \b: a custom property starts with "-", which is not a word character.
  const m = body.match(new RegExp(`[\\s;{]${prop}:\\s*(-?[\\d.]+)px`));
  if (!m) throw new Error(`no ${prop} in rule`);
  return Number(m[1]);
}

describe("activity bar footer dock", () => {
  it("fits the three buttons exactly into --sidebar-dock-h", () => {
    const dock = px(block(":root"), "--sidebar-dock-h");
    const btn = block(".footer-btn");
    const bottom = block(".activity-bar-bottom");
    const padding = Number(
      bottom.match(/\bpadding:\s*([\d.]+)px/)?.[1] ?? Number.NaN,
    );
    expect(Number.isNaN(padding)).toBe(false);
    expect(3 * px(btn, "height") + 2 * px(bottom, "gap") + 2 * padding).toBe(
      dock,
    );
  });

  it("uses one icon size across the whole rail", () => {
    // Above and below the divider are the same kind of control, so they are
    // the same size. Two scales in one rail is what this replaced.
    expect(px(block(".footer-btn .codicon"), "font-size")).toBe(
      px(
        block(".activity-icon .codicon,\n.activity-icon .brand-glyph"),
        "font-size",
      ),
    );
  });
});
