import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The overlay closes on a click outside itself, but it must NOT close on a
// click that lands on one of its OPENERS -- the spine dot or the titlebar
// mark. Both are toggles, and mousedown fires before click, so a close there
// would be undone by the opener's own click: the second click on an open
// project's dot would never close anything.
//
// That exclusion is a selector in one file naming classes rendered in two
// others, which is exactly the shape that rots silently on a rename. These
// assert both ends of it rather than trusting that they still agree.
const here = join(__dirname);
const read = (f: string) => readFileSync(join(here, f), "utf8");

describe("atlas overlay dismissal", () => {
  const overlay = read("AtlasOverlay.tsx");

  it("closes on an outside mousedown", () => {
    expect(overlay).toContain('addEventListener("mousedown"');
    expect(overlay).toContain("onClose()");
  });

  it("excludes the openers, which are toggles", () => {
    const selector = overlay.match(/closest\("([^"]+)"\)/)?.[1];
    expect(selector).toBeDefined();
    const classes = (selector as string).split(",").map((c) => c.trim());
    expect(classes).toContain(".atlas-spine");
    expect(classes).toContain(".titlebar-atlas");
  });

  it("names classes the openers actually render", () => {
    expect(read("AtlasSpine.tsx")).toContain('className="atlas-spine"');
    expect(read("AtlasTitlebarButton.tsx")).toContain(
      'className="titlebar-atlas"',
    );
  });
});
