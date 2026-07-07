# AirLock OAuth broker

A tiny **stateless** Cloudflare Worker that lets AirLock offer one-click OAuth
("log in → connected") for providers whose token exchange **requires a client
secret** (Slack, Notion, Linear, …) — which a distributed desktop app can't embed
safely.

It does exactly two things and **stores no user data**:

- `GET /callback?code&state` — the provider redirects here after the user
  approves. The Worker exchanges the `code` for a token **using the client
  secret it holds**, stashes the token under a random one-time ticket (30s TTL in
  KV), and bounces the browser to `airlock://oauth/<provider>?ticket=…&state=…`.
- `POST /redeem {ticket}` — AirLock redeems the ticket over HTTPS to get the
  token **once** (then it's deleted). The token then lives only in the user's
  macOS Keychain.

The client **secret never leaves Cloudflare**; the **token never persists** on the
Worker; `state` (`<provider>.<random>`) guards against CSRF/mismatch. Pure logic
is in `core.ts` (unit-tested by the repo's vitest); `worker.ts` is the thin
Cloudflare wiring.

## Deploy

```sh
npm i -g wrangler
wrangler login

# 1) Create the ticket KV namespace, paste its id into wrangler.toml.
wrangler kv namespace create TICKETS

# 2) Add each provider's OAuth app credentials as secrets (NOT committed).
wrangler secret put SLACK_CLIENT_ID
wrangler secret put SLACK_CLIENT_SECRET

# 3) Deploy — you get https://airlock-auth.<account>.workers.dev
wrangler deploy
```

Then register that Worker's `…/callback` as the **Redirect URL** on the provider's
OAuth app, and give AirLock the **Client ID** + the **Worker base URL** (both
public) for the extension descriptor.

## Add a provider

1. Add its token endpoint to `TOKEN_URLS` in `worker.ts`.
2. `wrangler secret put <PROVIDER>_CLIENT_ID` + `<PROVIDER>_CLIENT_SECRET`.
3. Register an AirLock extension descriptor with `flow: "broker"` pointing at
   this Worker.

No refresh endpoint yet — Slack user tokens are long-lived; add `/refresh` when a
provider issues short-lived access tokens.
