import { describe, expect, it } from "vitest";
import {
  CEILING_GH,
  type CiRunSummary,
  capItems,
  ledgerIsQuiet,
  parseIssueList,
  parsePrList,
  parseReleaseList,
  parseRunList,
  runIsNews,
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

const run = (
  conclusion: string | null,
  status = "completed",
): CiRunSummary => ({
  workflowName: "ci",
  status,
  conclusion,
  headBranch: "main",
  url: "u",
  at: SINCE + 1,
});

describe("runIsNews", () => {
  it("is true for the conclusions that mean something broke", () => {
    for (const c of [
      "failure",
      "timed_out",
      "startup_failure",
      "action_required",
    ])
      expect(runIsNews(run(c))).toBe(true);
  });

  it("is false for a green build and its quiet cousins", () => {
    // A passing nightly is the expected outcome and says nothing. Counting it
    // as activity made a repo with a scheduled workflow appear in the debrief
    // every single morning with nothing to report.
    for (const c of ["success", "skipped", "neutral", "cancelled", "stale"])
      expect(runIsNews(run(c))).toBe(false);
  });

  it("is false for a run still in flight", () => {
    // Not news either way yet, and it will be looked at again tomorrow.
    expect(runIsNews(run(null, "in_progress"))).toBe(false);
  });
});

describe("ledgerIsQuiet and CI", () => {
  const base = {
    root: "/p",
    sinceMs: SINCE,
    untilMs: SINCE + 100,
    capped: false,
    tree: {
      ok: true as const,
      value: { branch: "main", upstream: null, ahead: 0, behind: 0, dirty: 0 },
    },
    commits: { ok: true as const, value: [] },
    prs: { ok: true as const, value: [] },
    issues: { ok: true as const, value: [] },
    releases: { ok: true as const, value: [] },
  };

  it("stays quiet through a run of passing builds", () => {
    expect(
      ledgerIsQuiet({
        ...base,
        runs: { ok: true, value: [run("success"), run("success")] },
      }),
    ).toBe(true);
  });

  it("wakes on a single failure", () => {
    expect(
      ledgerIsQuiet({
        ...base,
        runs: { ok: true, value: [run("success"), run("failure")] },
      }),
    ).toBe(false);
  });

  it("still wakes on a commit whatever CI did", () => {
    expect(
      ledgerIsQuiet({
        ...base,
        commits: { ok: true, value: [{ hash: "a", at: SINCE, subject: "s" }] },
        runs: { ok: true, value: [run("success")] },
      }),
    ).toBe(false);
  });

  it("is not quiet when a probe could not be read", () => {
    expect(
      ledgerIsQuiet({ ...base, runs: { ok: false, reason: "gh boom" } }),
    ).toBe(false);
  });
});
