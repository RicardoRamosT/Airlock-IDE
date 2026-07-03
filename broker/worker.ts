// broker/worker.ts — Cloudflare Worker entry (deploy with `wrangler deploy`).
// A STATELESS OAuth broker: it holds only AirLock's client secrets (as Wrangler
// secrets), performs the code->token exchange a distributed desktop app can't do
// safely, and hands the token back to the app via a one-time, 30s ticket. It
// stores no user data. All pure logic + its tests live in core.ts; this file is
// the thin Cloudflare-runtime wiring (typechecked by wrangler at deploy).
import { exchangeAndTicket, type KV, type ProviderCfg, redeem } from "./core";

interface Env {
  TICKETS: KV;
  // Per-provider secrets set via `wrangler secret put SLACK_CLIENT_ID` etc.
  [k: string]: unknown;
}

// One token endpoint per supported provider. Add a line to onboard a provider.
const TOKEN_URLS: Record<string, string> = {
  slack: "https://slack.com/api/oauth.v2.access",
};

// state is "<provider>.<random>" so /callback learns the provider with no storage.
function providerFromState(state: string): string {
  return state.split(".")[0] ?? "";
}

function providerCfg(env: Env, provider: string): ProviderCfg | null {
  const id = env[`${provider.toUpperCase()}_CLIENT_ID`];
  const secret = env[`${provider.toUpperCase()}_CLIENT_SECRET`];
  const tokenUrl = TOKEN_URLS[provider];
  if (typeof id !== "string" || typeof secret !== "string" || !tokenUrl) {
    return null;
  }
  return { tokenUrl, clientId: id, clientSecret: secret };
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// An HTML page that bounces to the airlock:// deep link (more reliable than a
// 302 to a custom scheme) with a manual fallback link.
function bounce(deepLink: string): Response {
  const href = deepLink.replace(/"/g, "&quot;");
  const html = `<!doctype html><meta charset="utf-8"><title>AirLock</title>
<body style="font-family:system-ui;background:#0d1117;color:#c9d1d9;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><p>Connecting to AirLock&hellip;</p>
<p><a href="${href}" style="color:#58a6ff">Return to AirLock</a> &mdash; you can close this tab.</p></div>
<script>location.href=${JSON.stringify(deepLink)}</script>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // GET /callback?code&state -> exchange (with the secret) -> ticket -> airlock://
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      const cfg = providerCfg(env, providerFromState(state));
      if (!code || !cfg) return new Response("bad request", { status: 400 });
      const ticket = await exchangeAndTicket(
        cfg,
        code,
        `${url.origin}/callback`,
        { fx: fetch, kv: env.TICKETS, newTicket: () => crypto.randomUUID() },
      );
      if (!ticket)
        return new Response("token exchange failed", { status: 502 });
      return bounce(
        `airlock://oauth/${providerFromState(state)}?ticket=${encodeURIComponent(ticket)}&state=${encodeURIComponent(state)}`,
      );
    }

    // POST /redeem {ticket} -> {token} exactly once (then it is gone).
    if (req.method === "POST" && url.pathname === "/redeem") {
      const body = (await req.json().catch(() => ({}))) as { ticket?: string };
      if (!body.ticket) return json({ error: "no ticket" }, 400);
      const token = await redeem(env.TICKETS, body.ticket);
      return token ? json({ token }) : json({ error: "expired" }, 404);
    }

    return new Response("not found", { status: 404 });
  },
};
