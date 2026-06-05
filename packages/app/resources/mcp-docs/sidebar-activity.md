# Sidebar · Activity

## What it shows
A live feed of in-progress operations across the project's pipelines, with honest
progress — a determinate bar only where the source exposes real structure, an
animated indeterminate state otherwise. v1 sources:

- **GitHub CI** — the latest Actions workflow run for the current branch (via `gh`,
  so airlock never sees the token). The row expands to a step-checklist (each step
  shows running / passed / failed) and carries a determinate `steps done / total`
  progress bar. This is the section's real-progress highlight.
- **Render deploys** — a Render service that is mid-build/deploy, shown with an
  honest indeterminate animation (Render exposes a stage, not a percentage).
- **Docker** — containers in a transitional state (starting / restarting), shown
  with an honest "starting" animation. It does **not** show layer-by-layer pull or
  build progress (airlock doesn't run those, so there's no real layer % to report).

The section fetches when opened and on window focus, and polls every few seconds
while something is running; when nothing is running it stops polling. A manual
**Refresh** button (in the section toolbar) is always available. What it surfaces:
the latest CI run for the branch (in progress, or its most recent passed/failed
result), plus any Render deploy that is mid-build and any container that is still
starting/restarting — so when there is no such work it shows "Nothing active"
(Render services that are live and containers that are simply running are not
listed; they are not in-progress). There is no separate MCP status tool for it in
v1; it is a human-facing panel. Like the other sections it is toggleable —
`set_sidebar_section_visibility` accepts `activity`.

## When it's useful
Useful for any project with a pipeline worth watching live — one with GitHub Actions
on the current branch, a Render deploy, or containers that take a moment to come up.
Surface it when the human is shipping or iterating and wants build/deploy/container
progress at a glance without leaving airlock. For a project with no CI, no Render
service, and no containers it stays empty ("Nothing active") and can be hidden. It
defaults to collapsed.
