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

// Snowflake: warehouse state via `snow sql -q "SHOW WAREHOUSES" --format=json`.
// Steady-state under the databases view (a warehouse is a standing resource,
// not a transient op). STARTED/RESUMING -> running dot; SUSPENDED -> idle.
export const SNOWFLAKE: IntegrationManifest = {
  id: "snowflake",
  name: "Snowflake",
  surface: { view: "databases" },
  detect: { authCheck: { cmd: "snow", args: ["connection", "test"] } },
  poll: {
    everyMs: 30000,
    cli: {
      cmd: "snow",
      args: ["sql", "-q", "SHOW WAREHOUSES", "--format", "json"],
    },
  },
  map: {
    items: "$",
    key: "$.name",
    title: "$.name",
    subtitle: "$.size",
    state: {
      from: "$.state",
      running: ["STARTED", "RESUMING"],
      default: "idle",
    },
    show: ["running", "idle", "done", "failed"], // steady: show the full picture
  },
};

// Every shipped first-party integration. Adding one = appending a manifest.
export const INTEGRATIONS: IntegrationManifest[] = [VERCEL, SNOWFLAKE];
