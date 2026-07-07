// packages/app/src/main/extensions/oauth/broker.ts
// Runtime for the "broker" OAuth flow: for providers whose token exchange needs
// a client secret (Slack/Notion/Linear), AirLock can't be the confidential
// client -- our stateless Cloudflare Worker is. The app opens the provider's
// consent screen (redirect = the Worker), the Worker does the exchange with the
// secret and hands the token back via a one-time ticket over airlock://, and the
// app redeems that ticket here. Only PUBLIC config (client id, broker URL) is
// used on this side. buildAuthorizeUrl is pure (tested); runBrokerFlow is the
// thin I/O half (opens the browser + HTTPS redeem).
import { type AuthSpec, randomState } from "@airlock/agent-core";
import { awaitCallback } from "./deeplink";

// The broker arm of the AuthSpec union.
type BrokerAuthSpec = Extract<AuthSpec, { flow: "broker" }>;

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ json(): Promise<unknown> }>;

const realFetch: Fetch = (url, init) =>
  fetch(url, init) as unknown as Promise<{ json(): Promise<unknown> }>;

// Lazy so this module stays electron-free at import (buildAuthorizeUrl is unit
// tested; runBrokerFlow is the only caller and runs only in the live app).
async function realOpen(url: string): Promise<void> {
  const { shell } = await import("electron");
  await shell.openExternal(url);
}

// Build the provider's authorize URL. Pure. Scopes join with spec.scopeSep
// (Slack wants comma; RFC 6749 default is space) under spec.scopeParam (Slack
// user tokens need "user_scope"; default "scope").
export function buildAuthorizeUrl(
  spec: BrokerAuthSpec,
  state: string,
  redirectUri: string,
): string {
  const u = new URL(spec.authorizeUrl);
  u.searchParams.set("client_id", spec.clientId);
  u.searchParams.set(
    spec.scopeParam ?? "scope",
    spec.scopes.join(spec.scopeSep ?? " "),
  );
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

// Run the whole browser handoff: open the consent screen, await the airlock://
// callback (matched by a random state), redeem the one-time ticket at the
// broker, and return the access token. The token is the ONLY thing that comes
// back; the caller vaults it. Throws (friendly message) on timeout / bad config.
export async function runBrokerFlow(
  spec: BrokerAuthSpec,
  timeoutMs = 5 * 60_000,
  deps: {
    open?: (url: string) => Promise<void>;
    fx?: Fetch;
    wait?: typeof awaitCallback;
  } = {},
): Promise<string> {
  if (!spec.clientId || !spec.brokerBaseUrl) {
    throw new Error(
      "This extension isn't set up for one-click sign-in yet (missing broker config).",
    );
  }
  const open = deps.open ?? realOpen;
  const fx = deps.fx ?? realFetch;
  const wait = deps.wait ?? awaitCallback;
  const base = spec.brokerBaseUrl.replace(/\/$/, "");
  const state = randomState();
  await open(buildAuthorizeUrl(spec, state, `${base}/callback`));
  const { ticket } = await wait(state, timeoutMs);
  const res = await fx(`${base}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const j = (await res.json()) as { token?: unknown };
  if (typeof j.token !== "string" || !j.token) {
    throw new Error("Sign-in could not be completed (the ticket expired).");
  }
  return j.token;
}
