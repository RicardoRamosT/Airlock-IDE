# Sidebar · Docker

## What it shows
The local Docker engine state and its containers: whether Docker is installed and running,
and a row per container with its status and a start/stop action. It is machine-global (not
scoped to the open folder) — it reflects whatever Docker is doing on this machine.

The MCP tool `docker_status` returns the same: installed/running plus the container list.

## When it's useful
Useful when the project uses containers. Signals: a `Dockerfile`, a `docker-compose.yml` /
`compose.yaml`, a `.devcontainer`, or services the human runs in Docker (a local Postgres
container, Redis, etc.). For those projects, surface Docker so the human can see and toggle
containers without leaving airlock.

If the project has nothing to do with Docker — no Dockerfile/compose, no containerized
dependencies — hide this section. It defaults to collapsed. Note that because Docker is
machine-global, `docker_status` may still list unrelated containers; weigh that when
deciding whether the section is genuinely relevant to *this* project.
