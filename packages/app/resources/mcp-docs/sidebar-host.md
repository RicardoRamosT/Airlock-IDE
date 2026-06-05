# Sidebar · Host (local dev server + Render)

## What it shows
Two groups inside one section:

- **Local host** — the project's dev-server URL (from project config, else guessed from
  `package.json`) and a status dot showing whether that URL is reachable. The human can
  edit the URL inline and open it in a browser.
- **Render** — if a Render account is connected, the project's Render services with each
  service's deploy status and whether the live deploy matches the local HEAD commit.
  Services are filtered to the project's git origin when it matches.

MCP tools: `host_status` (the resolved dev URL + reachability) and `render_services` (the
Render services with deploy state). The Render API key stays main-only; the tool returns an
id/name/url/branch/deploy-status projection with no secrets.

## When it's useful
- **Local host** is useful for anything with a dev server — a web app or API the human runs
  locally. Signals: a `dev`/`start` script, a framework like Next/Vite/CRA/Astro (airlock
  guesses the port from these). Less useful for a pure library or a CLI with no server.
- **Render** is useful when the project deploys to Render. Signals: a `render.yaml`, the
  human has connected a Render account, or a Render service maps to this repo's origin. If
  the project deploys elsewhere (or nowhere), the Render group adds little.

Hide the whole section for a project that neither runs a local server nor deploys to
Render. It defaults to collapsed.
