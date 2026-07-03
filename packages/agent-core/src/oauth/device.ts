// packages/agent-core/src/oauth/device.ts
// Pure parsers for the OAuth 2.0 Device Authorization Grant (RFC 8628) responses.
// The device flow needs NO client secret, NO redirect, and NO local server -- the
// app shows a user code, the user approves in a browser, and the app polls. That
// makes it the simplest "log in -> connected" path (used by GitHub, Google,
// Azure, GitLab). The runtime (begin/poll I/O) lives in app/main; these are the
// defensive pure bits.

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// device_authorization response -> the code to show + how/when to poll.
export interface DeviceCode {
  deviceCode: string; // sent back when polling for the token
  userCode: string; // shown to the user to type at verificationUri
  verificationUri: string; // where the user goes to approve
  interval: number; // seconds between polls
  expiresIn: number; // seconds until the code expires
}

export function parseDeviceCode(json: unknown): DeviceCode | null {
  const r = obj(json);
  if (typeof r.device_code !== "string" || typeof r.user_code !== "string") {
    return null;
  }
  return {
    deviceCode: r.device_code,
    userCode: r.user_code,
    verificationUri:
      str(r.verification_uri) || str(r.verification_uri_complete),
    interval: typeof r.interval === "number" ? r.interval : 5,
    expiresIn: typeof r.expires_in === "number" ? r.expires_in : 900,
  };
}

// token-poll response -> a discriminated result the poller loops on. `pending`
// and `slow_down` mean keep polling; the rest are terminal.
export type DeviceTokenResult =
  | { status: "ok"; token: string }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "error"; error: string };

export function parseDeviceToken(json: unknown): DeviceTokenResult {
  const r = obj(json);
  if (typeof r.access_token === "string" && r.access_token) {
    return { status: "ok", token: r.access_token };
  }
  const e = str(r.error);
  if (e === "authorization_pending") return { status: "pending" };
  if (e === "slow_down") return { status: "slow_down" };
  if (e === "expired_token") return { status: "expired" };
  if (e === "access_denied") return { status: "denied" };
  return { status: "error", error: e || "unknown_error" };
}
