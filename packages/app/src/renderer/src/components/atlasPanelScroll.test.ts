import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The debrief used to scroll THE WHOLE APP.
//
// AtlasPanel's debrief branch emitted its blocks -- the brief and the "still
// open" section -- as bare siblings of the header, with no scroll container of
// its own. That worked only because the one host that existed,
// .atlas-popover, happened to be `overflow-y: auto`. The spine's .atlas-overlay
// is not, so a long brief pushed past the overlay's fixed height, and overflow
// with no scroll container between it and the document scrolls the DOCUMENT:
// the tab bar and the status bar slid off the top of the window.
//
// The fix is in the panel, not in one host's CSS: the panel now carries its own
// scroller, so no host has to be one. These assert that, and the containment
// behind it.
const src = (f: string) => readFileSync(join(__dirname, f), "utf8");
const css = readFileSync(join(__dirname, "..", "theme.css"), "utf8");

function block(selector: string): string {
  const m = css.match(new RegExp(`^\\${selector} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1] as string;
}

describe("atlas panel scrolling", () => {
  it("gives the debrief its own scroller, like the chat has", () => {
    expect(src("AtlasPanel.tsx")).toContain('className="atlas-pane-brief"');
    const pane = block(".atlas-pane-brief");
    expect(pane).toMatch(/overflow-y:\s*auto/);
    // Without this a flex item refuses to shrink below its content, so the
    // scroller would be as tall as the text and never actually scroll.
    expect(pane).toMatch(/min-height:\s*0/);
  });

  it("never lets a child of the overlay scroll the document", () => {
    expect(block(".atlas-overlay")).toMatch(/overflow:\s*hidden/);
  });

  it("measures the standing list against every host of the panel", () => {
    // The resize ceiling is computed from the HOST's height, found by a
    // hardcoded selector list. A host missing from it measures 0, which
    // resizeStanding reads as "no ceiling at all" -- so the drag could make
    // the list taller than the panel holding it.
    const selector = src("AtlasPanel.tsx").match(
      /closest<HTMLElement>\(\s*"([^"]+)"/,
    )?.[1];
    expect(selector).toBeDefined();
    const known = (selector as string).split(",").map((s) => s.trim());
    for (const host of [
      "AtlasPopover.tsx",
      "AtlasWindow.tsx",
      "AtlasOverlay.tsx",
    ]) {
      const body = src(host);
      // The element that directly wraps <AtlasPanel>, i.e. the last class
      // named before it.
      const before = body.slice(0, body.indexOf("<AtlasPanel"));
      const root = [...before.matchAll(/className="([\w-]+)"/g)].pop()?.[1];
      expect(root, `${host} has no host class`).toBeDefined();
      expect(known, `${host} hosts the panel`).toContain(`.${root}`);
    }
  });
});
