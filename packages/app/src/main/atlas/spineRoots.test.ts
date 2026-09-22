import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// WHOSE PROJECTS THE STRIP SHOWS.
//
// The dots are the projects in Atlas's debrief -- the enabled, non-missing
// registry -- and NOT the open tabs. The tab bar already says what is open, so
// a strip repeating it says nothing.
//
// The compiler forces a `roots` dependency to be passed, but not that the
// right thing is passed: handing it allOpenRoots would type-check perfectly
// and silently restore the old behaviour. That is the same shape as the
// `relevance` parameter that shipped defaulted and inert with every test
// green, so it is asserted rather than assumed.
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("spine roots", () => {
  it("does not read the open tabs", () => {
    expect(read("spine.ts")).not.toContain("allOpenRoots");
  });

  it("is wired to the debrief's enabled, present projects", () => {
    const main = readFileSync(join(__dirname, "..", "index.ts"), "utf8");
    const call = main.slice(main.indexOf("startSpine({"));
    expect(call).toContain("readRegistry()");
    // Enabled, because off means out of the debrief; present, because a
    // vanished folder would spend a git call to report that every probe
    // failed -- the same pair the debrief itself filters on.
    expect(call).toMatch(/p\.enabled/);
    expect(call).toMatch(/!p\.missing/);
  });

  it("moves the strip when a project is switched on or off", () => {
    // The dots ARE that list, so the toggle has to push; waiting for the next
    // tick would make the switch look like it did nothing.
    const ipc = readFileSync(join(__dirname, "..", "ipc.ts"), "utf8");
    const handler = ipc.slice(ipc.indexOf('"atlas:setProjectEnabled"'));
    expect(handler.slice(0, 1200)).toContain("refreshSpineRoots()");
  });
});
