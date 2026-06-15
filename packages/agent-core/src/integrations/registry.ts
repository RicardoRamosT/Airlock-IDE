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

// Neon: projects via `neonctl projects list --output json`, authed through the
// CLI's own login (`neonctl me`) -- no API key stored in AirLock. Steady-state
// under the databases view, beside the API-based Neon section. Projects have no
// live run state, so every project is an idle row (we read a state field that
// does not exist -> default idle). The CLI wraps the Neon API, whose list shape
// is `{ projects: [...] }`; if a future neonctl emits a bare array, change
// `items` to "$".
export const NEON: IntegrationManifest = {
  id: "neon",
  name: "Neon",
  surface: { view: "databases" },
  detect: { authCheck: { cmd: "neonctl", args: ["me"] } },
  poll: {
    everyMs: 30000,
    cli: { cmd: "neonctl", args: ["projects", "list", "--output", "json"] },
  },
  map: {
    items: "$.projects",
    key: "$.id",
    title: "$.name",
    subtitle: "$.region_id",
    state: { from: "$.state", default: "idle" }, // no live state -> idle
    show: ["running", "idle", "done", "failed"], // steady: show every project
  },
};

// Azure: App Service web apps via `az webapp list --output json`, authed through
// `az account show` (exit 0 when logged in). Steady-state under the host view,
// beside Render (both are cloud hosting). RUNNING -> running dot; anything else
// (Stopped) -> idle. `az ... list` emits a bare JSON array.
export const AZURE: IntegrationManifest = {
  id: "azure",
  name: "Azure",
  surface: { view: "host" },
  detect: { authCheck: { cmd: "az", args: ["account", "show"] } },
  poll: {
    everyMs: 30000,
    cli: { cmd: "az", args: ["webapp", "list", "--output", "json"] },
  },
  map: {
    items: "$",
    key: "$.name",
    title: "$.name",
    subtitle: "$.resourceGroup",
    state: { from: "$.state", running: ["Running"], default: "idle" },
    show: ["running", "idle", "done", "failed"], // steady: show every web app
  },
};

// Every shipped first-party integration. Adding one = appending a manifest.
export const INTEGRATIONS: IntegrationManifest[] = [
  VERCEL,
  SNOWFLAKE,
  NEON,
  AZURE,
];
