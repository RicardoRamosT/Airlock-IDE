import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "theme.css"), "utf8");

// Every rule that (re)defines the workspace grid's columns.
function workspaceGridRules(): { selector: string; tracks: string }[] {
  const out: { selector: string; tracks: string }[] = [];
  const re = /(\.workspace[^{]*)\{([^}]*)\}/g;
  let m = re.exec(css);
  while (m !== null) {
    const selector = (m[1] ?? "").trim();
    const body = m[2] ?? "";
    const decl = /grid-template-columns:\s*([^;]+);/.exec(body);
    if (decl) out.push({ selector, tracks: (decl[1] ?? "").trim() });
    m = re.exec(css);
  }
  return out;
}

describe("the workspace grid accounts for the Atlas spine", () => {
  // THE BUG THIS EXISTS FOR: the spine was added as a fourth column on the
  // base .workspace rule only. Three VARIANTS also define
  // grid-template-columns -- sidebar-right, sidebar-hidden, and the two
  // combined -- and with the sidebar hidden the grid had two columns, so the
  // spine found no track and auto-placement wrapped it to row 2 column 1: a
  // stack of dots at the bottom of the icon rail.
  //
  // The spine is the LAST in-flow child of .workspace, so every variant must
  // end with a track for it. A rule that redefines the columns and forgets it
  // silently relocates the strip rather than failing.
  it("every variant that redefines the columns ends with the spine's track", () => {
    const rules = workspaceGridRules();
    // Guard the guard: if the selectors are ever renamed, this test must fail
    // loudly rather than pass over an empty list.
    expect(rules.length).toBeGreaterThanOrEqual(4);
    for (const r of rules)
      expect(
        r.tracks.trimEnd().endsWith("auto"),
        `${r.selector} defines grid-template-columns without a trailing spine track: ${r.tracks}`,
      ).toBe(true);
  });
});
