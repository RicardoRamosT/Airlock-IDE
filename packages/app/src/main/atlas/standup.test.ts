import type {
  CodeLedger,
  DebriefWindow,
  SessionDigest,
} from "@airlock/agent-core";
import { describe, expect, it, vi } from "vitest";
import { runStandup, type StandupDeps } from "./standup";

const WINDOW: DebriefWindow = { sinceMs: 0, untilMs: 10, capped: false };

const quiet = (root: string): CodeLedger => ({
  root,
  sinceMs: 0,
  untilMs: 10,
  capped: false,
  tree: {
    ok: true,
    value: { branch: "main", upstream: null, ahead: 0, behind: 0, dirty: 0 },
  },
  commits: { ok: true, value: [] },
  prs: { ok: true, value: [] },
  runs: { ok: true, value: [] },
  issues: { ok: true, value: [] },
  releases: { ok: true, value: [] },
});

const busy = (root: string): CodeLedger => ({
  ...quiet(root),
  commits: { ok: true, value: [{ hash: "a", at: 5, subject: "did a thing" }] },
});

const digest: SessionDigest = {
  id: "s",
  title: "t",
  startedAt: 1,
  endedAt: 2,
  userMessages: 4,
  compactSummaries: [],
  lastPrompt: "x",
  tail: "me: x",
};

function deps(over: Partial<StandupDeps> = {}): StandupDeps {
  return {
    ledger: async (root) => busy(root),
    digests: async () => [digest],
    report: async (jobs) =>
      jobs.map((j) => ({
        root: j.ledger.root,
        did: ["d"],
        standing: [],
        gaps: [],
      })),
    ...over,
  };
}

describe("runStandup", () => {
  it("spends nothing on a quiet project", async () => {
    const report = vi.fn(async () => []);
    const r = await runStandup(
      deps({
        ledger: async (root) => quiet(root),
        digests: async () => [],
        report,
      }),
      ["/a", "/b"],
      WINDOW,
    );
    expect(report).not.toHaveBeenCalled();
    expect(r.quiet).toBe(2);
    expect(r.ledgers).toHaveLength(0);
  });

  it("spends nothing on a project with facts but no session memory", async () => {
    // The budget rule: a reporter distils MEMORY. '3 commits, CI green' is
    // already prose and needs no model.
    const report = vi.fn(async () => []);
    const r = await runStandup(
      deps({ digests: async () => [], report }),
      ["/a"],
      WINDOW,
    );
    expect(report).not.toHaveBeenCalled();
    expect(r.quiet).toBe(0);
    expect(r.ledgers).toHaveLength(1);
  });

  it("asks only the projects that have memory", async () => {
    const report = vi.fn(async (jobs: { ledger: CodeLedger }[]) =>
      jobs.map((j) => ({
        root: j.ledger.root,
        did: ["d"],
        standing: [],
        gaps: [],
      })),
    );
    const r = await runStandup(
      deps({
        digests: async (root) => (root === "/a" ? [digest] : []),
        report,
      }),
      ["/a", "/b"],
      WINDOW,
    );
    expect(report.mock.calls[0]?.[0].map((j) => j.ledger.root)).toEqual(["/a"]);
    expect(r.reports).toHaveLength(1);
  });

  it("bounds the whole standup with a deadline the reporters can see", async () => {
    // G5 has to be reachable: an unanswered reporter must be abandoned, not
    // waited on, or one wedged CLI holds the debrief for as long as it likes.
    let seen: AbortSignal | undefined;
    await runStandup(
      deps({
        report: async (_jobs, signal) => {
          seen = signal;
          return [];
        },
      }),
      ["/a"],
      WINDOW,
    );
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  it("keeps a project whose ledger probe threw", async () => {
    const r = await runStandup(
      deps({
        ledger: async (root) => {
          if (root === "/bad") throw new Error("git exploded");
          return busy(root);
        },
      }),
      ["/bad", "/good"],
      WINDOW,
    );
    // G5/G6: a project never vanishes because a probe failed.
    expect(r.ledgers.map((l) => l.root).sort()).toEqual(["/bad", "/good"]);
    const bad = r.ledgers.find((l) => l.root === "/bad");
    expect(bad?.commits.ok).toBe(false);
  });
});
