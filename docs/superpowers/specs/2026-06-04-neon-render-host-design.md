# Neon Databases + Host (Local/Render) Design

**Date:** 2026-06-04
**Status:** Design approved. Building Slice A (Neon) first, then Slice B (Host).

## Overview
Two additions, both extending the existing sidebar + secret-broker model:
1. **Neon in Databases** - native browsing of a Neon account (projects -> branches -> databases) using a vaulted Neon API key, reusing the existing live-dot / tables / read-only data-grid.
2. **Host section** - a new sidebar section showing where the current project runs: LOCAL (dev server up/down) and RENDER (deploy status + "latest commit deployed?").

## Shared foundation: app-global credentials
Today every secret is per-project (keychain account `${projectId}:${name}`, read only main-side via the main-only `getSecretValue`). Neon and Render API keys are account-level, not project-level, so this adds an **app-global** credential namespace:
- Stored in the SAME macOS Keychain service ("airlock"), under a reserved global account prefix that can never collide with a real project path (e.g. an account string that is not a valid absolute path, like `@global/<name>`).
- New main-only `getGlobalSecretValue(name)` / `setGlobalSecret(name, value)` on the broker, mirroring the per-project ones: set is write-only from the renderer's view (returns nothing sensitive), reads happen ONLY main-side, are NEVER returned over renderer IPC, and are NEVER registered as an agent tool.
- Access recorded in the hash-chained append-only audit log, tagged global.
- The renderer's only knobs: "is a key set?" (boolean) and "set/replace the key" (secure input, reusing the existing SecretModal). It never reads the value back.

**Security invariant (unchanged, extended):** the agent and renderer can never read a credential value. The global API keys, and any connection strings airlock fetches from Neon/Render using them, are main-only; error messages are scrubbed (`redactConnStrings`); nothing is logged raw.

## Slice A - Neon in Databases
**Neon API client** (agent-core, electron-free, DI'd transport so it is testable):
- `listProjects(key)` -> GET /api/v2/projects
- `listBranches(key, projectId)` -> GET .../branches
- `listDatabases(key, projectId, branchId)` -> GET .../databases
- `connectionUri(key, projectId, branchId, db, role)` -> GET .../connection_uri (returns a connstring WITH password; MAIN-ONLY, never crosses IPC)
Pure response parsers are TDD'd; the HTTP transport (global `fetch`, available in the Electron/Node main) is the untested adapter, like the pg client.

**Reuse:** once main has a branch/db connection_uri (fetched on demand with the global key), it reuses the existing `withDb` + `pingDb` (live dot) + `listTables` + `readRows` (data grid). No new query path.

**IPC (main-side; app-global, NOT requireRoot-gated since Neon is account-level):**
- `neon:status` -> `{ connected: boolean }` (is a Neon key vaulted?)
- `neon:connect(key)` -> vault the key (`setGlobalSecret`), returns `{ connected: true }`
- `neon:tree` -> projects -> branches -> databases (METADATA only; no connstrings)
- `neon:ping(projectId, branchId, db)` -> resolve connection_uri main-side, SELECT 1, return ok/err (scrubbed)
- `neon:tables(...)` / `neon:rows(...)` -> resolve connection_uri main-side, reuse explorer; return tables / rows (never the connstring)

**UI:** a **Neon** group at the top of the Databases section. No key -> "Connect Neon" button (-> SecretModal -> `neon:connect`). Key set -> the projects/branches/databases tree; each database leaf reuses the existing DB-entry behavior (dot, expand tables, click -> data grid in the viewer-pane via the existing `dbView` discriminator).

## Slice B - Host section
A new **toggleable** sidebar section "host" (added to SECTIONS / SectionVisibility / the View -> Sidebar menu / the gating from the section-visibility phase). Two groups:

**LOCAL - the project's dev server:**
- URL resolution: `.airlock/config.json` `devUrl` if set; else guessed from `package.json` (framework defaults: vite 5173, next 3000, etc., or an explicit `--port`).
- Live dot: a short TCP connect to 127.0.0.1:port (agent-core `probePort`, DI'd) -> up/down. Refresh on window focus + manual.
- Actions: open-in-browser (`shell.openExternal(url)` - opens the system browser, NOT an airlock window, so it does not violate the no-new-windows rule), and set/edit the dev URL (writes `.airlock/config.json`).

**RENDER - this project's services:**
- Render API client (agent-core, DI'd transport): `listServices(key)` -> GET /v1/services; `latestDeploy(key, serviceId)` -> GET /v1/services/{id}/deploys?limit=1.
- Filter: show services whose repo matches the open project's `git remote get-url origin` (normalized https/ssh forms); fall back to all services if no remote match.
- Per service: live status dot (active + latest deploy live), latest deploy state (live / building / failed / canceled), and a **"latest commit deployed"** check - compare the latest deploy's commit SHA to the repo's latest commit on the deployed branch (airlock already shells out to git). Shows deployed / N behind.
- Render API key is app-global (Connect Render -> SecretModal), same as Neon.

## Sequencing & decisions
- Build Slice A first (extends Databases), then Slice B (new section).
- Decisions (approved): app-global API keys; Render filtered to the project's repo (fallback all); local dev URL guessed from `package.json` with a per-project override.

## Out of scope (v1)
- Hostinger / other hosts (the ask mentioned "and more") - deferred; RENDER is the first host provider, structured so more can be added later.
- Writing to Neon/Render (creating branches, triggering deploys) - read-only/status only for v1.
- Neon org/multi-account selection - assume a single Neon account per vaulted key for v1.
