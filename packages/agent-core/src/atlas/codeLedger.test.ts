import { describe, expect, it } from "vitest";
import {
  CEILING_GH,
  capItems,
  parseIssueList,
  parsePrList,
  parseReleaseList,
  parseRunList,
} from "./codeLedger";

const SINCE = Date.UTC(2026, 8, 11, 0, 0, 0);

describe("parsePrList", () => {
  it("parses gh's shape and keeps only what changed in the window", () => {
    const raw = JSON.stringify([
      {
        number: 1,
        title: "Old",
        state: "MERGED",
        updatedAt: "2026-09-01T00:00:00Z",
        url: "u1",
      },
      {
        number: 2,
        title: "New",
        state: "OPEN",
        updatedAt: "2026-09-12T08:00:00Z",
        url: "u2",
      },
    ]);
    const out = parsePrList(raw, SINCE);
    expect(out.map((p) => p.number)).toEqual([2]);
    expect(out[0]?.title).toBe("New");
  });

  it("returns [] for junk rather than throwing", () => {
    // A tolerant parser is the rule everywhere in Atlas: one odd row must not
    // blank the project. But [] here means 'asked and empty' -- the CALLER
    // decides whether asking failed. See Probe in codeRunners.
    expect(parsePrList("not json", SINCE)).toEqual([]);
    expect(parsePrList("{}", SINCE)).toEqual([]);
    expect(parsePrList("[]", SINCE)).toEqual([]);
  });

  it("skips a malformed row and keeps the rest", () => {
    const raw = JSON.stringify([
      { number: "nope", updatedAt: "2026-09-12T08:00:00Z" },
      {
        number: 3,
        title: "Fine",
        state: "OPEN",
        updatedAt: "2026-09-12T08:00:00Z",
        url: "u3",
      },
    ]);
    expect(parsePrList(raw, SINCE).map((p) => p.number)).toEqual([3]);
  });
});

describe("parseRunList", () => {
  it("keeps conclusion null for a run still going", () => {
    const raw = JSON.stringify([
      {
        workflowName: "ci",
        status: "in_progress",
        conclusion: null,
        headBranch: "main",
        url: "u",
        createdAt: "2026-09-12T08:00:00Z",
      },
    ]);
    const [run] = parseRunList(raw, SINCE);
    expect(run?.conclusion).toBeNull();
    expect(run?.status).toBe("in_progress");
  });
});

describe("parseIssueList / parseReleaseList", () => {
  it("filters each by its own timestamp field", () => {
    const issues = JSON.stringify([
      {
        number: 7,
        title: "i",
        state: "CLOSED",
        updatedAt: "2026-09-12T08:00:00Z",
        url: "u",
      },
    ]);
    expect(parseIssueList(issues, SINCE)).toHaveLength(1);
    const rels = JSON.stringify([
      {
        tagName: "v0.7.0",
        name: "AirLock v0.7.0",
        publishedAt: "2026-09-01T00:00:00Z",
        url: "u",
      },
    ]);
    expect(parseReleaseList(rels, SINCE)).toHaveLength(0);
  });
});

describe("capItems", () => {
  it("reports what it withheld instead of dropping it silently", () => {
    const many = Array.from({ length: CEILING_GH + 5 }, (_, i) => i);
    const { items, withheld } = capItems(many, CEILING_GH);
    expect(items).toHaveLength(CEILING_GH);
    expect(withheld).toBe(5);
  });

  it("withholds nothing at exactly the ceiling", () => {
    // Straddle the boundary on purpose: an off-by-one here invents a
    // "1 more not listed" line on a perfectly complete list.
    const exact = Array.from({ length: CEILING_GH }, (_, i) => i);
    expect(capItems(exact, CEILING_GH).withheld).toBe(0);
  });
});
