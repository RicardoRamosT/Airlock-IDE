import type { DebriefWindow } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import { collectLedger, type LedgerDeps } from "./codeRunners";

const WINDOW: DebriefWindow = {
  sinceMs: Date.UTC(2026, 8, 11),
  untilMs: Date.UTC(2026, 8, 12),
  capped: false,
};

function deps(over: Partial<LedgerDeps> = {}): LedgerDeps {
  return {
    git: {
      exists: async () => true,
      isRepo: async () => true,
      status: async () =>
        ({
          branch: {
            head: "main",
            upstream: "origin/main",
            ahead: 2,
            behind: 0,
          },
          staged: [],
          unstaged: [{}],
          untracked: [],
        }) as never,
      log: async () => [
        { hash: "abc", at: Date.UTC(2026, 8, 11, 12), subject: "fix a thing" },
      ],
    },
    gh: async () => ({ run: async () => "[]", account: "me", degraded: null }),
    ...over,
  };
}

describe("collectLedger", () => {
  it("fills every probe from a healthy project", async () => {
    const l = await collectLedger(deps(), "/p", WINDOW);
    expect(l.commits.ok && l.commits.value).toHaveLength(1);
    expect(l.tree.ok && l.tree.value.ahead).toBe(2);
    expect(l.tree.ok && l.tree.value.dirty).toBe(1);
    expect(l.prs.ok && l.prs.value).toEqual([]);
  });

  it("records WHY a gh probe failed instead of reporting an empty list", async () => {
    // The whole point of Probe. An empty PR list and a broken gh call must not
    // render the same, or the debrief says 'no PRs' forever.
    const l = await collectLedger(
      deps({
        gh: async () => ({
          run: async () => {
            throw new Error("gh: could not resolve repository");
          },
          account: null,
          degraded: null,
        }),
      }),
      "/p",
      WINDOW,
    );
    expect(l.prs.ok).toBe(false);
    expect(l.prs.ok === false && l.prs.reason).toContain("could not resolve");
  });

  it("marks every gh probe degraded when the pin could not be honoured", async () => {
    const l = await collectLedger(
      deps({
        gh: async () => ({
          run: async () => "[]",
          account: null,
          degraded: "pinned to X but its gh token could not be read",
        }),
      }),
      "/p",
      WINDOW,
    );
    // It ANSWERED, but as the wrong account, so the answer is not trustworthy.
    expect(l.prs.ok).toBe(false);
    expect(l.prs.ok === false && l.prs.reason).toContain("pinned to X");
  });

  it("degrades a non-repo to a ledger rather than throwing", async () => {
    const l = await collectLedger(
      deps({ git: { ...deps().git, isRepo: async () => false } }),
      "/p",
      WINDOW,
    );
    expect(l.commits.ok).toBe(false);
    expect(l.tree.ok).toBe(false);
  });

  it("caps commits and says how many it withheld", async () => {
    const many = Array.from({ length: 1005 }, (_, i) => ({
      hash: String(i),
      at: Date.UTC(2026, 8, 11, 12),
      subject: `c${i}`,
    }));
    const l = await collectLedger(
      deps({ git: { ...deps().git, log: async () => many } }),
      "/p",
      WINDOW,
    );
    expect(l.commits.ok && l.commits.value).toHaveLength(1000);
    expect(l.commits.ok && l.commits.withheld).toBe(5);
  });
});
