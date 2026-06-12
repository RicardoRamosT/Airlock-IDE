// packages/agent-core/src/integrations/registry.test.ts
import { describe, expect, it } from "vitest";
import { mapToItems } from "./map";
import { INTEGRATIONS, VERCEL } from "./registry";

// Captured shape of `vercel ls --json` (trimmed to the fields the manifest reads).
const VERCEL_FIXTURE = {
  deployments: [
    {
      uid: "dpl_1",
      name: "web",
      url: "web-abc.vercel.app",
      readyState: "BUILDING",
      meta: { githubCommitRef: "main" },
    },
    {
      uid: "dpl_2",
      name: "web",
      url: "web-xyz.vercel.app",
      readyState: "READY",
      meta: { githubCommitRef: "main" },
    },
    {
      uid: "dpl_3",
      name: "web",
      url: "web-err.vercel.app",
      readyState: "ERROR",
      meta: { githubCommitRef: "fix-1" },
    },
  ],
};

describe("VERCEL manifest", () => {
  it("is registered", () => {
    expect(INTEGRATIONS).toContain(VERCEL);
  });
  it("surfaces an in-progress and a failed deploy, not the ready one", () => {
    expect(mapToItems(VERCEL, VERCEL_FIXTURE)).toEqual([
      {
        id: "int:vercel:dpl_1",
        title: "web",
        subtitle: "main",
        state: "running",
        href: "web-abc.vercel.app",
      },
      {
        id: "int:vercel:dpl_3",
        title: "web",
        subtitle: "fix-1",
        state: "failed",
        href: "web-err.vercel.app",
      },
    ]);
  });
});
