# Sidebar · Secrets

## What it shows
The project's vaulted secrets, listed by **name** only (with a key icon). Each row lets the
human update or delete the value, and the section has a "Import from `.env`" action and an
"inject secrets into the terminal" toggle. Secret **values are never shown to you**. Values
live in the OS keychain.

The human **owner** has two per-row hover actions for their own use: an **eye** to reveal a
value inline, and a **copy** button (puts the value on the clipboard, which then auto-clears
after a delay set in **Settings → Secrets** — default 30s, `0` = never; the risk of the
shared clipboard is explained there). These are owner-only renderer actions; **you have no
value path** — they are not MCP tools, the value never reaches you, and the copy resolves
the value main-side so it never even enters the UI. See `security-model.md`.

The MCP tool `list_secret_names` mirrors this: it returns each secret's name, provider, and
whether it looks valid — never the value. See `security-model.md`.

## When it's useful
Useful for any project that has credentials: an API-driven app, anything with a database
URL, anything that talks to a third-party service (OpenAI, Stripe, AWS, etc.). Signals: a
`.env` / `.env.example` file, a `process.env.*` / `os.environ[...]` usage, an SDK that
needs a key. If the project is a pure offline library or a static site with no credentials,
Secrets carries little and can be hidden to reduce clutter.

Use this section's status (via `list_secret_names`) to reason about what the project needs
— e.g. "there's a `DATABASE_URL` secret, so the Databases section is relevant" — but never
to try to obtain the value itself.
