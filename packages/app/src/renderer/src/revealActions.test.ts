import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A HIDDEN ACTION MUST HAVE SOMETHING THAT SHOWS IT.
//
// `.row-action.reveal` is `opacity: 0`, and the rule that brings it back is
// wired PER ROW CONTAINER -- so a `.reveal` used inside a container nobody
// wired is invisible and still fully clickable. opacity does not remove hit
// testing. That shipped: the Atlas settings list got a `reveal` trash button
// inside `.atlas-project`, which has no trigger, and the user deleted a
// project by clicking a control they could not see.
//
// theme.css already says the quiet part -- "opacity:0 keeps it in the a11y
// tree but invisible, which is worse than absent" -- about a different rule.
// This asserts it.
const CSS = readFileSync(join(__dirname, "theme.css"), "utf8");
const COMPONENTS = join(__dirname, "components");

// Every container that has a rule turning a .reveal back on.
function triggers(): string[] {
  return [...CSS.matchAll(/\.([\w-]+):hover\s+\.row-action\.reveal/g)].map(
    (m) => m[1] as string,
  );
}

describe("reveal-on-hover actions", () => {
  it("has at least the known triggers", () => {
    // Guards the regex itself: if it stops matching, every assertion below
    // passes vacuously.
    expect(triggers().length).toBeGreaterThanOrEqual(3);
  });

  it("is only used where a container reveals it", () => {
    const known = triggers();
    const offenders: string[] = [];
    for (const f of readdirSync(COMPONENTS)) {
      if (!f.endsWith(".tsx") || f.includes(".test.")) continue;
      const src = readFileSync(join(COMPONENTS, f), "utf8");
      // A className, not the words anywhere in the file -- a comment
      // EXPLAINING this bug is not an instance of it.
      const uses = [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
        .map((m) => m[1] ?? m[2] ?? "")
        .some((c) => /\brow-action\b/.test(c) && /\breveal\b/.test(c));
      if (!uses) continue;
      // The file must also name a container that has a trigger.
      if (!known.some((c) => src.includes(c))) offenders.push(f);
    }
    expect(
      offenders,
      `these hide a row action with no rule to bring it back: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
