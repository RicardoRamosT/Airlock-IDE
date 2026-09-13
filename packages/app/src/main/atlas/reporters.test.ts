import type { CodeLedger, SessionDigest } from "@airlock/agent-core";
import { describe, expect, it, vi } from "vitest";
import { type ReporterJob, runReporters } from "./reporters";

const ledger = (root: string): CodeLedger => ({
  root,
  sinceMs: 0,
  untilMs: 1,
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

const digest: SessionDigest = {
  id: "s",
  title: "t",
  startedAt: 0,
  endedAt: 1,
  userMessages: 3,
  compactSummaries: [],
  lastPrompt: "x",
  tail: "me: x",
};

const jobs = (roots: string[]): ReporterJob[] =>
  roots.map((r) => ({ ledger: ledger(r), digests: [digest] }));

const envelope = (text: string) =>
  JSON.stringify({ result: text, total_cost_usd: 0 });

describe("runReporters", () => {
  it("returns one report per job", async () => {
    const spawn = vi.fn(async () =>
      envelope('{"did":["shipped it"],"standing":[],"gaps":[]}'),
    );
    const out = await runReporters(spawn, jobs(["/a", "/b"]));
    expect(out).toHaveLength(2);
    expect(out[0]?.did).toEqual(["shipped it"]);
  });

  it("uses sonnet and forbids tools, so a reporter cannot go exploring", async () => {
    let args: string[] = [];
    const spawn = vi.fn(async (a: string[]) => {
      args = a;
      return envelope('{"did":[],"standing":[],"gaps":[]}');
    });
    await runReporters(spawn, jobs(["/a"]));
    expect(args).toContain("claude-sonnet-5");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disallowed-tools");
  });

  it("drops a project whose reporter throws, and keeps the others", async () => {
    // G5: the standup degrades to the ledger for that project, and the debrief
    // still arrives. One wedged CLI must not cost the whole morning.
    const spawn = vi.fn(async (_a: string[], stdin: string) => {
      if (stdin.includes("bad")) throw new Error("spawn failed");
      return envelope('{"did":["fine"],"standing":[],"gaps":[]}');
    });
    const out = await runReporters(spawn, jobs(["/p/bad", "/p/good"]));
    expect(out.map((r) => r.root)).toEqual(["/p/good"]);
  });

  it("drops a project whose reporter answers in prose", async () => {
    const spawn = vi.fn(async () =>
      envelope("Sure! Yesterday you worked on it."),
    );
    expect(await runReporters(spawn, jobs(["/a"]))).toEqual([]);
  });
});
