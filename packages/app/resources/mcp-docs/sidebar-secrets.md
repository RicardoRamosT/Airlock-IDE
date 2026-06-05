# Sidebar · Secrets

## What it shows
The project's vaulted secrets, listed by **name** only (with a key icon). Each row lets the
human update or delete the value, and the section has a "Import from `.env`" action and an
"inject secrets into the terminal" toggle. Secret **values are never shown here** — not to
the human in the list, and never to you. Values live in the OS keychain.

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
