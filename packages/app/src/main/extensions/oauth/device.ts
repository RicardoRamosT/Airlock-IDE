// packages/app/src/main/extensions/oauth/device.ts
// Runtime for the OAuth 2.0 Device Authorization Grant (RFC 8628): begin (get a
// user code) and poll (until the user approves) -- NO client secret, NO redirect,
// NO local server, so this is the simplest "log in -> connected" path. The pure
// response parsing lives in agent-core (oauth/device); this is the thin I/O half.
// fetch/sleep/now are injectable so the poll loop is unit-testable without network.
import {
  type AuthSpec,
  type DeviceCode,
  parseDeviceCode,
  parseDeviceToken,
} from "@airlock/agent-core";

// The device-flow arm of the AuthSpec union (has deviceCodeUrl/tokenUrl). The
// engine narrows on spec.flow before calling in here.
type DeviceAuthSpec = Extract<AuthSpec, { flow: "device" }>;

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ json(): Promise<unknown> }>;

const realFetch: Fetch = (url, init) =>
  fetch(url, init) as unknown as Promise<{ json(): Promise<unknown> }>;

// The vault key that holds a connected extension's OAuth token. Shared by the
// engine (writes it after login) and the provider/tools (read it). Per-project.
export function oauthTokenName(id: string): string {
  return `${id.toUpperCase()}_OAUTH_TOKEN`;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

// Start the device flow: ask the provider for a device+user code to show.
export async function beginDeviceFlow(
  spec: DeviceAuthSpec,
  fx: Fetch = realFetch,
): Promise<DeviceCode> {
  const res = await fx(spec.deviceCodeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form({ client_id: spec.clientId, scope: spec.scopes.join(" ") }),
  });
  const code = parseDeviceCode(await res.json());
  if (!code) throw new Error("Device authorization failed to start.");
  return code;
}

// Poll the token endpoint until the user approves (or it fails/expires). Returns
// the access token. `pending` waits `interval`; `slow_down` bumps it by 5s (per
// RFC 8628); terminal states throw. Bounded by `expiresInSec`.
export async function pollDeviceToken(
  spec: DeviceAuthSpec,
  deviceCode: string,
  intervalSec: number,
  expiresInSec: number,
  deps: {
    fx?: Fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<string> {
  const fx = deps.fx ?? realFetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + expiresInSec * 1000;
  let interval = Math.max(1, intervalSec);
  while (now() < deadline) {
    await sleep(interval * 1000);
    const res = await fx(spec.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form({
        client_id: spec.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const r = parseDeviceToken(await res.json());
    if (r.status === "ok") return r.token;
    if (r.status === "slow_down") {
      interval += 5;
      continue;
    }
    if (r.status === "pending") continue;
    throw new Error(
      r.status === "expired"
        ? "Device code expired -- please try connecting again."
        : r.status === "denied"
          ? "Access was denied."
          : `OAuth error: ${r.error}`,
    );
  }
  throw new Error("Device authorization timed out.");
}
