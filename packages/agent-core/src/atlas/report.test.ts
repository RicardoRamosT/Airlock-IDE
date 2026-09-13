import { describe, expect, it } from "vitest";
import type { CodeLedger } from "./codeLedger";
import { buildReportPrompt, parseReport } from "./report";
import type { SessionDigest } from "./sessions";

const LEDGER: CodeLedger = {
  root: "/Users/me/Projects/Trackview",
  sinceMs: Date.UTC(2026, 8, 11),
  untilMs: Date.UTC(2026, 8, 12),
  capped: false,
  tree: {
    ok: true,
    value: {
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      dirty: 3,
    },
  },
  commits: {
    ok: true,
    value: [
      { hash: "a", at: Date.UTC(2026, 8, 11, 9), subject: "fix pricing" },
    ],
  },
  prs: { ok: false, reason: "gh: could not resolve repository" },
  runs: { ok: true, value: [] },
  issues: { ok: true, value: [] },
  releases: { ok: true, value: [] },
};

const DIGEST: SessionDigest = {
  id: "s1",
  title: "Monday data verification with prod",
  startedAt: Date.UTC(2026, 8, 11, 15),
  endedAt: Date.UTC(2026, 8, 12, 2),
  userMessages: 570,
  compactSummaries: ["We reconciled the Monday board against prod."],
  lastPrompt: "check the last 20 rows again",
  tail: "me: check the last 20 rows again",
};

describe("buildReportPrompt", () => {
  it("names the project and carries both halves", () => {
    const p = buildReportPrompt(LEDGER, [DIGEST]);
    expect(p).toContain("Trackview");
    expect(p).toContain("fix pricing");
    expect(p).toContain("Monday data verification with prod");
    expect(p).toContain("We reconciled the Monday board against prod.");
  });

  it("tells the model which probes failed so it can report the gap", () => {
    // Without this the model sees no PR section and infers there were none.
    expect(buildReportPrompt(LEDGER, [DIGEST])).toContain(
      "could not resolve repository",
    );
  });
});

describe("parseReport", () => {
  it("parses the strict shape", () => {
    const r = parseReport("/r", '{"did":["a"],"standing":["b"],"gaps":[]}');
    expect(r).toEqual({ root: "/r", did: ["a"], standing: ["b"], gaps: [] });
  });

  it("tolerates a fenced block, which models emit constantly", () => {
    const r = parseReport(
      "/r",
      '```json\n{"did":["a"],"standing":[],"gaps":[]}\n```',
    );
    expect(r?.did).toEqual(["a"]);
  });

  it("returns null for prose so the caller can degrade to the ledger", () => {
    expect(
      parseReport("/r", "Sure! Here is what happened yesterday."),
    ).toBeNull();
  });

  it("drops non-string entries rather than trusting the shape", () => {
    const r = parseReport(
      "/r",
      '{"did":["ok",7,null],"standing":"nope","gaps":[]}',
    );
    expect(r?.did).toEqual(["ok"]);
    expect(r?.standing).toEqual([]);
  });
});
