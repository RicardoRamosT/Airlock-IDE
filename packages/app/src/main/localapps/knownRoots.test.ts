import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeProjectRoots } from "./scan";

// WHICH DIRECTORIES COUNT AS YOURS.
//
// A listening process qualifies on its working directory, and that predicate
// does two jobs at once: "is this one of your apps" and "whose is it".
// The set it ran against was allOpenRoots(), so failing the second question
// killed the first -- a 7-day dev server in a project with no tab open was
// dropped before its age was ever looked at, while an identical server in an
// open project was reported. Closing a tab silently stopped the monitoring.
//
// The set is now every project AirLock knows about. It still cannot admit
// system software: clamd, OneDrive, rapportd and ControlCenter all run from
// "/", which is nobody's project.
describe("mergeProjectRoots", () => {
  it("unions the three sources AirLock knows projects from", () => {
    expect(
      mergeProjectRoots(["/p/open"], ["/p/watched"], ["/p/recent"]),
    ).toEqual(["/p/open", "/p/watched", "/p/recent"]);
  });

  it("keeps a project that is watched but has no tab open", () => {
    // The case this exists for. ElArqui: watched, no tab, a next-server up
    // seven days on :3005 that the bell never mentioned.
    expect(mergeProjectRoots([], ["/p/ElArqui"], [])).toContain("/p/ElArqui");
  });

  it("de-duplicates, since the sources overlap heavily", () => {
    expect(
      mergeProjectRoots(["/p/a", "/p/b"], ["/p/b"], ["/p/a", "/p/c"]),
    ).toEqual(["/p/a", "/p/b", "/p/c"]);
  });

  it("drops blanks rather than admitting every directory", () => {
    // An empty string is a PREFIX OF EVERYTHING. attributeToRoot matches
    // segment-wise, but letting one through would be one bad match away from
    // reporting the operating system.
    expect(mergeProjectRoots(["", "   "], [""], [])).toEqual([]);
  });
});

describe("the root set is actually wired", () => {
  // The compiler forces a `knownRoots` dependency to be passed but not what it
  // returns: handing it `allOpenRoots` would type-check perfectly and restore
  // the bug in silence. Same shape as the `relevance` parameter that once
  // shipped defaulted and inert with every test green, and as the spine's
  // roots -- so it is asserted rather than assumed.
  const main = readFileSync(join(__dirname, "..", "index.ts"), "utf8");
  const call = main.slice(
    main.indexOf("configureLocalApps({"),
    main.indexOf("startLocalAppsPoll()"),
  );

  it("draws on all three sources, not just the open tabs", () => {
    expect(call).toContain("mergeProjectRoots(");
    expect(call).toContain("allOpenRoots()");
    expect(call).toContain("readRegistry()");
    expect(call).toContain("recentFolders");
  });

  it("does not filter the registry to the debrief's enabled rows", () => {
    // "Not in the debrief" is not "not my project" -- a switched-off project's
    // dev server still costs RAM and battery.
    expect(call).not.toMatch(/\.enabled/);
  });

  it("no longer passes the open tabs alone to the scan", () => {
    const poll = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(poll).not.toContain("roots: allOpenRoots");
  });
});
