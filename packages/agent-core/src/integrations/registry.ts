// packages/agent-core/src/integrations/registry.ts
import type { IntegrationManifest } from "./manifest";

// Vercel: deployments via `vercel ls --json`. BUILDING/QUEUED is a transitional
// Activity row; ERROR is surfaced as failed; READY is steady (not shown by
// default). cwdScoped: the CLI resolves the project from the working directory.
export const VERCEL: IntegrationManifest = {
  id: "vercel",
  name: "Vercel",
  detect: { authCheck: { cmd: "vercel", args: ["whoami"] } },
  poll: {
    everyMs: 20000,
    cwdScoped: true,
    cli: { cmd: "vercel", args: ["ls", "--json"] },
  },
  map: {
    items: "$.deployments",
    key: "$.uid",
    title: "$.name",
    subtitle: "$.meta.githubCommitRef",
    href: "$.url",
    state: {
      from: "$.readyState",
      running: ["BUILDING", "QUEUED", "INITIALIZING"],
      done: ["READY"],
      failed: ["ERROR", "CANCELED"],
      default: "idle",
    },
  },
};

// Every shipped first-party integration. Adding one = appending a manifest.
export const INTEGRATIONS: IntegrationManifest[] = [VERCEL];
