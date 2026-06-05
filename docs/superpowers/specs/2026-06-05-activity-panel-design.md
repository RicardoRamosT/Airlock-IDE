# Activity Panel (live pipeline progress) Design

**Date:** 2026-06-05
**Status:** v1 complete.

## Overview
A new toggleable "Activity" sidebar section: a unified, animated live feed of in-progress operations. v1 sources:
- **GitHub CI** (Actions runs for the current branch, via `gh`) -- the real-progress star: a step-checklist + a determinate `steps done / total` bar.
- **Render deploys** (via the existing Render integration) -- stage progress (build -> deploy -> live) + an honest indeterminate shimmer while "building" (Render gives no granular %).
- **Docker** -- transitional container states (created/restarting -> running) shown as an honest "starting" animation. NO fake layer-% (airlock does not run/tail the pull or build, so there is no real layer progress to show; true layer-pull progress is deferred to when airlock owns builds).

The panel polls while it is expanded AND something is active, and backs off to idle when nothing is running.

## Honest progress model (carry everywhere)
- Determinate bar ONLY where the source gives discrete structure: CI = completed steps / total steps (Actions exposes jobs[].steps[]).
- Indeterminate shimmer/pulse where the source gives only a state: Render "building", Docker "starting".
- Never a fabricated number. A state with no structure animates; it does not show a fake %.

## Architecture
- **NEW agent-core CI client** (`github/ci.ts`, electron-free, DI'd `gh` runner -- mirror `github/accounts.ts`): `latestCiRun(branch, run=realGh)` -> `gh run list --branch <b> --limit 1 --json databaseId,status,conclusion,workflowName,headSha,headBranch` then `gh run view <id> --json jobs` -> a `CiRun` { workflowName, status (queued|in_progress|completed), conclusion (success|failure|cancelled|null), headSha, steps: {name,status,conclusion}[], stepsDone, stepsTotal }. Pure parsers (parseRunList, parseRunJobs -> flattened steps + counts) are TDD'd; the `gh` shell-out is the untested DI adapter; ENOENT -> "gh not found" graceful (like accounts).
- **Activity aggregation** (main): gather CI (current branch, if a repo) + Render (reuse `renderServicesStatus` / the latest-deploy state) + Docker (reuse `dockerStatus`, pick transitional containers) into `ActivityItem[]` { id, kind: "ci"|"render"|"docker", title, subtitle, state: "running"|"done"|"failed"|"idle", progress: { kind:"determinate", value:number, label:string } | { kind:"indeterminate" } | null, href? }. Lives alongside ide-state (reuses its render/docker reads + the new CI client). NOT requireRoot for render/docker; CI needs the repo (skip if no root/remote).
- **IPC**: `activity:status` -> ActivityItem[] (single aggregated call the panel polls). preload + shared types.
- **The 8th toggleable "activity" section**: add to the Section type / prefs SECTIONS + DEFAULT / store default / menu SECTION_LABELS / Sidebar gating (the section-visibility machinery, same ripple as adding "host").
- **ActivitySection** renderer component: polls `activity:status` on a timer while expanded + active (and on window focus); renders each item with the animation vocabulary; CI item expands to the step-checklist.

## Animations (CSS-driven, theme-aware, subtle -- match the VS Code feel)
First keyframes in the app (none today). Add:
- **Determinate bar**: a `.progress-bar > .fill` with a smooth `width` transition (CI steps, eventual docker layers).
- **Indeterminate shimmer**: a CSS keyframe sweeping a gradient across the bar (Render building / Docker starting).
- **Pulsing dot**: a keyframe on the status dot while `state==="running"`; settles to solid `--accent` on done, flashes `--red` on fail.
- **CI step-checklist**: each step row shows a spinner (running) / check (passed) / x (failed); rows transition as they complete.
- Respect `prefers-reduced-motion` (disable the keyframes, keep the determinate fill) -- tasteful + accessible.

## Polling / cadence
- Poll `activity:status` only while the Activity section is EXPANDED. While any item is `running`, poll ~3s; when all items are idle/done, stop polling (show the last state) and only refresh on window focus or manual refresh. Avoids constant `gh`/API calls + battery drain.
- CI polling is the cost driver (`gh` spawn per poll); cap to the active window.

## Security
- CI via `gh` (gh holds the GitHub token; airlock never sees it -- same as the accounts feature). Render via the vaulted key (main-only, existing). Docker via the CLI. NO new secret surface; all of this is non-secret status metadata. No value ever crosses.

## Out of scope (v1)
- airlock OWNING/triggering builds or pulls (so true Docker layer-% and a "merge button that kicks off CI" are deferred).
- A `ci_status` MCP tool for the agent (natural follow-up -- this slice is the human-facing panel).
- Per-step logs, historical runs (just the latest/active run per source), multi-workflow (show the most recent workflow run; multiple concurrent workflows = a later refinement).
- A status-bar pulse (a nice later add; v1 is the panel).
