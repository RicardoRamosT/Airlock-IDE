import { expect, it } from "vitest";
import {
  buildBriefPrompt,
  MAX_COMMITS_PER_PROJECT,
  MAX_PROMPT_CHARS,
} from "./brief";
import type { RootSnapshot } from "./collect";

const snap = (
  root: string,
  over: Partial<RootSnapshot> = {},
): RootSnapshot => ({
  root,
  missing: false,
  isRepo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  dirty: 0,
  commits: [],
  ...over,
});

const commits = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    hash: `h${i}`,
    at: 1756512000000,
    subject: `change number ${i}`,
  }));

const NOW = Date.UTC(2026, 7, 30, 9, 0, 0);
const SINCE = NOW - 24 * 60 * 60 * 1000;

it("names each project and its recent activity", () => {
  const out = buildBriefPrompt(
    [snap("/p/Muros-Estates", { ahead: 34, commits: commits(3) })],
    SINCE,
    NOW,
  );
  expect(out).toContain("Muros-Estates");
  expect(out).toContain("34");
  expect(out).toContain("change number 0");
});

it("caps commits per project so one busy repo cannot dominate the prompt", () => {
  // Revaltone-CRM produced 170 commits in seven days on the author's machine.
  const out = buildBriefPrompt(
    [snap("/p/busy", { commits: commits(170) })],
    SINCE,
    NOW,
  );
  expect(out).toContain(`change number ${MAX_COMMITS_PER_PROJECT - 1}`);
  expect(out).not.toContain(`change number ${MAX_COMMITS_PER_PROJECT}`);
  expect(out).toMatch(/150 more/);
});

it("stays under the total prompt cap even with a very large portfolio", () => {
  const many = Array.from({ length: 300 }, (_, i) =>
    snap(`/p/project-${i}`, { commits: commits(MAX_COMMITS_PER_PROJECT) }),
  );
  expect(buildBriefPrompt(many, SINCE, NOW).length).toBeLessThanOrEqual(
    MAX_PROMPT_CHARS,
  );
});

it("says so explicitly when there was no activity at all", () => {
  // A quiet day must produce a brief that STATES the gap. Silence is
  // indistinguishable from failure, which is how Helm's dead MCP looked.
  const out = buildBriefPrompt([snap("/p/a"), snap("/p/b")], SINCE, NOW);
  expect(out).toMatch(/no commits|no activity/i);
});

it("handles a completely empty portfolio without producing a broken prompt", () => {
  const out = buildBriefPrompt([], SINCE, NOW);
  expect(out.length).toBeGreaterThan(0);
  expect(out).toMatch(/no projects/i);
});

it("reports a missing root as missing and does not claim activity for it", () => {
  const out = buildBriefPrompt(
    [snap("/p/gone", { missing: true })],
    SINCE,
    NOW,
  );
  expect(out).toContain("gone");
  expect(out).toMatch(/missing|no longer/i);
});

it("mentions unpushed work, which is the signal git makes free", () => {
  const out = buildBriefPrompt([snap("/p/a", { ahead: 34 })], SINCE, NOW);
  expect(out).toMatch(/unpushed|ahead/i);
});

it("does not mention ahead counts for a repo with no upstream", () => {
  const out = buildBriefPrompt(
    [snap("/p/local", { upstream: null, ahead: 0 })],
    SINCE,
    NOW,
  );
  expect(out).toMatch(/no remote/i);
});
