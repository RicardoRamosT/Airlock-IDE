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
  // Account-wide CLI: only surface in projects that use Snowflake.
  relevance: { envPrefix: "SNOWFLAKE_" },
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
  install: { command: "brew install snowflake-cli" },
  connect: { command: "snow connection add" }, // interactive terminal setup, no browser
};

// NOTE: there is deliberately NO Neon CLI manifest. Unlike snow/az/vercel (which
// fail non-interactively when unauthenticated), `neonctl` AUTO-LAUNCHES a browser
// OAuth flow when its token is missing or expired -- so background-polling it
// every cycle spams "Log in to Neon" tabs (diagnosed 2026-06-15). It is therefore
// unsafe as a steady integration. Neon is already covered by the richer
// API-based NeonSection, so nothing is lost.

// Azure: App Service web apps via `az webapp list --output json`, authed through
// `az account show` (exit 0 when logged in). Steady-state under the host view,
// beside Render (both are cloud hosting). RUNNING -> running dot; anything else
// (Stopped) -> idle. `az ... list` emits a bare JSON array.
export const AZURE: IntegrationManifest = {
  id: "azure",
  name: "Azure",
  surface: { view: "host" },
  // `az webapp list` is account-wide, so only surface Azure in projects that
  // use it: a vaulted AZURE_* secret, or an Azure Developer CLI config in root.
  relevance: {
    envPrefix: "AZURE_",
    files: ["azure.yaml", "azure.yml", ".azure"],
  },
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
    // Shown when a row is expanded.
    details: [
      { label: "State", value: "$.state" },
      { label: "Region", value: "$.location" },
      { label: "URL", value: "$.defaultHostName" },
    ],
    // Row actions. Portal opens the resource page; Start/Stop run the az CLI in
    // a terminal and are gated to the state where they make sense. Substituted
    // {{...}} values are shell-quoted for command actions (see map.ts).
    actions: [
      {
        label: "Portal",
        icon: "link-external",
        kind: "url",
        template: "https://portal.azure.com/#@/resource{{$.id}}/overview",
      },
      {
        label: "Start",
        icon: "play",
        kind: "command",
        template:
          "az webapp start --name {{$.name}} --resource-group {{$.resourceGroup}}",
        when: ["idle"],
      },
      {
        label: "Stop",
        icon: "debug-stop",
        kind: "command",
        template:
          "az webapp stop --name {{$.name}} --resource-group {{$.resourceGroup}}",
        when: ["running"],
      },
    ],
  },
  install: { command: "brew install azure-cli" },
  connect: { command: "az login" }, // opens a browser, but only on user click (not polled)
};

// Every shipped first-party integration. Adding one = appending a manifest.
export const INTEGRATIONS: IntegrationManifest[] = [VERCEL, SNOWFLAKE, AZURE];
