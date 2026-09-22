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
//
// The rest of the file guards the same SHAPE of mistake: three surfaces render
// AtlasPanel, and each time one of them was added it had to be taught things
// the others already knew. Every assertion here is a contract a host owes the
// panel, or a piece of tuning the panel must not inherit from a host that no
// longer exists.
const src = (f: string) => readFileSync(join(__dirname, f), "utf8");
const css = readFileSync(join(__dirname, "..", "theme.css"), "utf8");

function block(selector: string): string {
  const m = css.match(new RegExp(`^\\${selector} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1] as string;
}

// A rule's padding `right`, written longhand or as a one-to-four shorthand.
function paddingRight(body: string): string {
  const longhand = body.match(/padding-right:\s*([^;]+);/);
  const raw =
    longhand !== null
      ? (longhand[1] as string)
      : ((body.match(/[\s;{]padding:\s*([^;]+);/)?.[1] ?? "")
          .trim()
          .split(/\s+/)[1] ??
        body.match(/[\s;{]padding:\s*([^;]+);/)?.[1] ??
        "");
  return raw.trim().replace(/px$/, "");
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

  it("sizes its own text, on every host", () => {
    // .atlas-popover and .atlas-window both declare font-size: 13px, and
    // .atlas-brief pins 13px of its own -- so on a host that declares none,
    // the brief stayed 13px while everything that inherits (the "still open"
    // rows especially) jumped to the app's base size. Two type scales in one
    // panel, which is what it looked like.
    for (const host of [".atlas-popover", ".atlas-window", ".atlas-overlay"]) {
      expect(block(host), `${host} sets no font-size`).toMatch(/font-size:/);
    }
  });

  it("keeps host tuning out of the shared chat wrapper", () => {
    // .atlas-pane-chat wraps the chat in EVERY host, but its overrides were
    // written for the Atlas SIDEBAR SECTION -- 2px of padding, 12px bubbles, a
    // composer with no background -- and that section no longer exists. They
    // stayed, so the overlay's chat wore a narrow column's costume while the
    // debrief beside it did not. Layout only here; typography and spacing
    // belong to the chat's own rules or to a host-scoped one.
    const rules = [
      ...css.matchAll(/^([^\n{}]*\.atlas-pane-chat[^\n{}]*)\{([^}]*)\}/gm),
    ];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) {
      expect(body, `${(selector as string).trim()} tunes spacing`).not.toMatch(
        /padding:/,
      );
      expect(body, `${(selector as string).trim()} tunes type`).not.toMatch(
        /font-size:/,
      );
    }
  });

  it("spends the same right gutter on the scrollbar in both panes", () => {
    // The chat and the debrief scroll in different elements, so this is the
    // only thing keeping them looking alike. A classic WebKit scrollbar always
    // takes its width out of the content box and is always drawn at the
    // padding-box edge -- it CANNOT be overlaid -- so the nearest thing to
    // "in front of the chat" is for both panes to spend their right gutter on
    // it rather than gutter AND bar. One of them drifting back to a padded
    // gutter is what makes one look narrower than the other.
    for (const pane of [".atlas-pane-brief", ".atlas-chat-log"]) {
      expect(paddingRight(block(`.atlas-overlay ${pane}`)), pane).toBe("0");
    }
  });
});
