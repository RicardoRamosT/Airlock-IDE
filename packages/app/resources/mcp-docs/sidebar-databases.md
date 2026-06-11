# Sidebar · Databases (and Neon)

## What it shows
Two groups inside one section:

- **Databases** — the project's vaulted Postgres connection-string secrets, shown as
  redacted info (host, database, user — never the password) with a reachability status dot
  from a short-lived ping. Expanding a database lists its tables; clicking a table opens
  the rows in a data grid in the main area.
- **Neon** — if a Neon account is connected, a lazy tree of projects → branches →
  databases → tables, each database self-pinging for its status dot. Tables open in the
  data grid too.

MCP tools: `database_status` (vaulted Postgres DBs with redacted info + reachability) and
`neon_status` (connected? plus the Neon projects when connected). Neither returns a
connection string or password — resolution happens main-side only.

## When it's useful
Useful when the project talks to a Postgres database. Signals:

- A `postgres-url` secret exists (a `DATABASE_URL` / `POSTGRES_URL` in Secrets) → show
  **Databases**.
- The project uses **Neon** specifically (a Neon connection host, a `neon` dependency, or
  the human has connected a Neon account) → the **Neon** group is the relevant one.

If the project has no database — a static site, a frontend-only app, a CLI with no
persistence — hide this section. It defaults to collapsed, so even when relevant it stays
out of the way until expanded.
