// packages/app/src/main/extensions/oauth/deeplink.ts
// The airlock:// deep-link handler + pending-flow registry for the broker OAuth
// flow. runBrokerFlow (engine) opens the provider consent screen with a random
// `state` and awaits a callback keyed by that state; the broker Worker redirects
// the browser to airlock://oauth/<id>?ticket=…&state=…, which macOS delivers to
// this running instance. resolveCallback matches the state (the CSRF guard),
// hands back the one-time ticket, and the engine redeems it for the token.
//
// awaitCallback/resolveCallback are pure (unit-tested); registerAirlockProtocol
// is the thin electron wiring.
import path from "node:path";
import type { App } from "electron";

interface Pending {
  resolve: (v: { ticket: string }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Flows awaiting their browser callback, keyed by OAuth `state`.
const pending = new Map<string, Pending>();

// Await the browser callback for `state`. Resolves with the one-time ticket when
// a matching airlock:// URL arrives; rejects if none does within timeoutMs.
export function awaitCallback(
  state: string,
  timeoutMs: number,
): Promise<{ ticket: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(state);
      reject(new Error("Sign-in timed out. Please try connecting again."));
    }, timeoutMs);
    // Don't keep the process alive just for a long-lived sign-in timer.
    (timer as { unref?: () => void }).unref?.();
    pending.set(state, { resolve, reject, timer });
  });
}

// Route an incoming airlock:// URL to its pending flow. Returns true if it
// matched a live flow (and resolved it), false otherwise: a non-airlock URL, a
// malformed URL, a missing ticket/state, or an unknown/already-consumed state
// (which is exactly the CSRF/interception guard — an unsolicited callback is a
// no-op).
export function resolveCallback(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "airlock:") return false;
  const state = parsed.searchParams.get("state");
  const ticket = parsed.searchParams.get("ticket");
  if (!state || !ticket) return false;
  const p = pending.get(state);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(state);
  p.resolve({ ticket });
  return true;
}

// Claim the airlock:// scheme and route callbacks to resolveCallback. macOS
// delivers the deep link to the running instance via "open-url" (we hold the
// single-instance lock, so this is the primary). Called once at startup.
export function registerAirlockProtocol(app: App): void {
  // In dev the stock Electron binary needs argv so the OS maps the scheme to
  // this instance; packaged builds register the bundle itself.
  const script = process.defaultApp ? process.argv[1] : undefined;
  if (script) {
    app.setAsDefaultProtocolClient("airlock", process.execPath, [
      path.resolve(script),
    ]);
  } else {
    app.setAsDefaultProtocolClient("airlock");
  }
  app.on("open-url", (e, url) => {
    e.preventDefault();
    resolveCallback(url);
  });
}
