// broker/core.ts
// The PURE logic of the OAuth broker (no Cloudflare runtime, so it's unit-tested
// by the repo's vitest). The Worker entry (worker.ts) wires these to CF globals.
// The broker exchanges an auth code for a token USING the client secret (the one
// thing a distributed desktop app can't do), stashes the token under a one-time,
// 30s ticket, and later hands it back once. It stores no user data.

// A minimal KV surface (Cloudflare KV implements this; tests use a Map).
export interface KV {
  put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface ProviderCfg {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

// Pull the access token out of a token-endpoint response. Handles a top-level
// access_token (bot/generic OAuth) AND Slack's user-token shape
// ({ ok, authed_user: { access_token } }). null on any failure.
export function extractToken(j: unknown): string | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (typeof o.access_token === "string" && o.access_token)
    return o.access_token;
  const au = o.authed_user;
  if (au && typeof au === "object") {
    const t = (au as Record<string, unknown>).access_token;
    if (typeof t === "string" && t) return t;
  }
  return null;
}

// Exchange the auth code for a token (with the secret), stash it under a random
// one-time ticket (30s TTL), return the ticket. null (storing nothing) if the
// exchange fails.
export async function exchangeAndTicket(
  cfg: ProviderCfg,
  code: string,
  redirectUri: string,
  deps: { fx: FetchLike; kv: KV; newTicket: () => string },
): Promise<string | null> {
  const res = await deps.fx(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const token = extractToken(res.ok ? await res.json() : null);
  if (!token) return null;
  const ticket = deps.newTicket();
  await deps.kv.put(`t:${ticket}`, token, { expirationTtl: 30 });
  return ticket;
}

// Return the token for a ticket exactly once, then delete it.
export async function redeem(kv: KV, ticket: string): Promise<string | null> {
  const key = `t:${ticket}`;
  const token = await kv.get(key);
  if (token) await kv.delete(key);
  return token;
}
