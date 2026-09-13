import { describe, expect, it } from "vitest";
import { buildBriefPrompt, MAX_PROMPT_CHARS } from "./brief";
import type { CodeLedger } from "./codeLedger";
import type { ProjectReport } from "./report";

const WINDOW = {
  sinceMs: Date.UTC(2026, 8, 11),
  untilMs: Date.UTC(2026, 8, 12),
  capped: false,
};
const NOW = Date.UTC(2026, 8, 12, 9);

const ledger = (root: string, over: Partial<CodeLedger> = {}): CodeLedger => ({
  root,
  sinceMs: WINDOW.sinceMs,
  untilMs: WINDOW.untilMs,
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
    value: [{ hash: "a", at: NOW, subject: "fix pricing" }],
  },
  prs: { ok: true, value: [] },
  runs: { ok: true, value: [] },
  issues: { ok: true, value: [] },
  releases: { ok: true, value: [] },
  ...over,
});

const report = (root: string): ProjectReport => ({
  root,
  did: ["Reconciled the Monday board against prod."],
  standing: ["Two rows still disagree."],
  gaps: [],
});

describe("buildBriefPrompt", () => {
  it("renders the ledger's numbers itself, not the model's", () => {
    // G1. The reporter's sentence is narrative; the counts come from data, so
    // a model that forgets a fact cannot remove it from the page.
    const p = buildBriefPrompt(
      [ledger("/p/Trackview")],
      [report("/p/Trackview")],
      0,
      WINDOW,
      NOW,
    );
    expect(p).toContain("1 commit");
    expect(p).toContain("2 unpushed");
    expect(p).toContain("3 uncommitted");
    expect(p).toContain("Reconciled the Monday board against prod.");
  });

  it("states a failed probe instead of omitting the section", () => {
    // G2. An absent PR line and a broken gh call must not render the same.
    const p = buildBriefPrompt(
      [
        ledger("/p/ElArqui", {
          prs: { ok: false, reason: "gh: could not resolve repository" },
        }),
      ],
      [],
      0,
      WINDOW,
      NOW,
    );
    expect(p).toContain("could not be read");
    expect(p).toContain("could not resolve repository");
  });

  it("says how many projects were quiet", () => {
    // G6. Absence is never ambiguous.
    expect(buildBriefPrompt([ledger("/p/a")], [], 15, WINDOW, NOW)).toContain(
      "15",
    );
  });

  it("says when the window was capped", () => {
    // G3.
    const p = buildBriefPrompt(
      [ledger("/p/a")],
      [],
      0,
      { ...WINDOW, capped: true },
      NOW,
    );
    expect(p.toLowerCase()).toContain("capped");
  });

  it("says when a ceiling withheld commits", () => {
    // G4. A cap that fires in silence is the defect this replaces.
    const p = buildBriefPrompt(
      [
        ledger("/p/a", {
          commits: {
            ok: true,
            value: [{ hash: "a", at: NOW, subject: "s" }],
            withheld: 42,
          },
        }),
      ],
      [],
      0,
      WINDOW,
      NOW,
    );
    expect(p).toContain("42");
  });

  it("never drops a project for length", () => {
    // The old prompt omitted whole projects past MAX_PROMPT_CHARS. Per-project
    // reporting means the debrief carries summaries, not commit lists, so the
    // cap is a guard rather than a routine truncation.
    const many = Array.from({ length: 60 }, (_, i) => ledger(`/p/proj${i}`));
    const p = buildBriefPrompt(many, [], 0, WINDOW, NOW);
    expect(p).toContain("proj59");
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });
});
