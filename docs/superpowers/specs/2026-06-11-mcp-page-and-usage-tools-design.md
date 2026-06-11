# MCP page-tab control + plan-usage tools — design

**Date:** 2026-06-11 · **Status:** approved

## Goal

Two agent-facing gaps closed by three new MCP tools (allowlist 22 → 25):

1. The agent can open/close the IDE-level **Settings** and **Usage** page-tabs
   (it could already drive project tabs / split / terminals, but not the
   page-tabs added in the page-tab UI change).
2. The agent can read **its own Claude plan usage** — the same account-wide
   data the sidebar quota meter and the Usage dashboard show — so it can
   answer "how much quota is left / what's eating it" without the human
   relaying screenshots.

## Tools

### `open_app_page` / `close_app_page` (IDE-control family → nine tools)

- Args: `page: z.enum(["settings", "usage"])`. Returns the layout snapshot,
  like every IDE-control tool. Acts on the FOCUSED window via the existing
  `runAgentCommand` round-trip. **No workspace gate** (page-tabs exist in any
  window, including blank-tab ones).
- New `AgentCommand` variants in `shared/ipc.ts` (+ exported
  `type AppPage = "settings" | "usage"`):
  `{ type: "open_app_page"; page: AppPage }` and
  `{ type: "close_app_page"; page: AppPage }`. The renderer's `applyCommand`
  maps them 1:1 onto the existing store actions `openAppPage(p)` /
  `closeAppPage(p)`. Open also un-hides an already-open page (store
  semantics); close on a not-open page is a clean no-op.
- `TabsSnapshot` gains `appPages: { open: AppPage[]; shown: AppPage | null }`,
  built in `buildSnapshot()` from `settingsTabOpen` / `usageTabOpen` /
  `appPage`. Every IDE-control reply (incl. `list_tabs`) now reports page-tab
  state. Page names only — no new value surface.

### `plan_usage` (status-read family, app-global)

- No args, no workspace gate (quota is account-wide, like the meter).
  Returns `{ meterEnabled, quota, sessions }`:
  - `meterEnabled` — `loadPrefs(deps.prefsFile).quotaMeter.enabled`, so the
    agent can tell "feature off" from "no session emitting yet".
  - `quota` — main's cached `QuotaStatus` (`fiveHour`/`sevenDay` windows with
    `usedPercentage` + `resetsAt`, `model`, `updatedAt`, `available`); `null`
    until a session emits. `updatedAt` is the freshness signal (old ⇒ no live
    session is feeding the meter).
  - `sessions` — the Usage dashboard's ledger (`SessionUsage[]`: `sessionId`,
    `cwd`, `model`, point-in-time `contextTokens`/`contextWindowSize`,
    cumulative `costUsd`/`apiMs`/`linesAdded`/`linesRemoved`, `lastEmitAt`),
    sorted busiest-first (by `apiMs`).
- Wiring: two new injected `ToolDeps` — `getQuota`, `getUsageLedger` — passed
  from `index.ts` (imports from `quota/watch.ts`), same pattern as
  `getActivity`. Keeps `tools.ts` testable with fakes and free of direct
  quota imports.

## Security

No change to the no-secret-values invariant: usage percentages, costs, cwd
paths, and page names only. Neither new dep is value-returning; the
source-guard test's forbidden-identifier list is untouched. `plan_usage` is
read-only; the page tools carry an enum in, layout metadata out.

## Tests

- `tools.test.ts`: allowlist guard 22 → 25 (+ the three names); `baseDeps`
  gains `getQuota`/`getUsageLedger` fakes; handler tests — page tools forward
  the right `AgentCommand` and map ok/!ok; `plan_usage` returns the fakes'
  data + `meterEnabled` and works with no workspace. The mcp-docs parity
  tests pick up the new names + "25 tools" once `tools.md` says so.
- `server.test.ts`: "EXACTLY the twenty-two" → twenty-five.
- Renderer `applyCommand`/`buildSnapshot` additions are thin store-action
  wiring (repo convention: untested); the store actions themselves are
  already covered.

## Docs (MCP manual)

- `tools.md`: count → 25 (ten status reads, nine IDE-control), a `plan_usage`
  entry under app-global status reads, the two page tools under "Driving the
  IDE", new "Picking a tool" lines.
- `ide-control.md`: "Seven tools" → nine; layout shape gains `appPages`;
  replace the "these tools do not open them" note with the new tools.
- `overview.md`: page-tabs paragraph — the agent can now open/close them;
  mention `plan_usage` beside the usage-meter sentence.

## Delivery

Branch `mcp-page-and-usage-tools` → merge --no-ff to main → repackage →
verify the bundle (new tool names in the main bundle, updated docs in
`Resources/mcp-docs/`). Live verification needs an app relaunch (the running
MCP server registered the old 22 at startup).
