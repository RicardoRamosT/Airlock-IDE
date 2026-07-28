import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(path.join(here, "../../../../README.md"), "utf8");

// GitHub rewrites relative links in a rendered README to absolute blob URLs --
// but NOT inside footnote definitions. An unrewritten relative link is then
// resolved by the browser against the page URL, so `docs/threat-model.md` in a
// footnote on github.com/<owner>/<repo> becomes github.com/<owner>/docs/... and
// 404s.
//
// This shipped: the footnote qualifying the comparison table's "can't read a
// secret" tick pointed at the threat model, and the one link a skeptical reader
// most needs was dead on the published README. Caught by a reader, not by us.
describe("README footnote links", () => {
  // A footnote definition is `[^n]:` plus its indented continuation lines.
  const footnoteBlocks = () => {
    const lines = readme.split("\n");
    const blocks: string[] = [];
    let cur: string[] | null = null;
    for (const l of lines) {
      if (/^\[\^[^\]]+\]:/.test(l)) {
        if (cur) blocks.push(cur.join("\n"));
        cur = [l];
      } else if (cur && (l.startsWith("    ") || l.trim() === "")) {
        if (l.trim() === "") {
          blocks.push(cur.join("\n"));
          cur = null;
        } else cur.push(l);
      } else if (cur) {
        blocks.push(cur.join("\n"));
        cur = null;
      }
    }
    if (cur) blocks.push(cur.join("\n"));
    return blocks;
  };

  it("finds the footnotes it is meant to be checking", () => {
    // Guards the guard: a regex that silently matches nothing would make this
    // suite pass forever while checking not one link.
    expect(footnoteBlocks().length).toBeGreaterThan(0);
  });

  it("uses absolute URLs, because GitHub will not rewrite relative ones here", () => {
    for (const block of footnoteBlocks()) {
      for (const m of block.matchAll(/\]\(([^)]+)\)/g)) {
        const target = m[1];
        if (!target) continue;
        // In-page anchors are fine -- they need no rewriting.
        if (target.startsWith("#")) continue;
        expect(
          target.startsWith("https://"),
          `relative link "${target}" inside a footnote will 404 on GitHub`,
        ).toBe(true);
      }
    }
  });
});
