// Focus-gated polling: run `tick` on an interval ONLY while the window is
// focused. Used by sidebar status sections (e.g. LocalHostSection) whose data
// can change outside the app, so the view must self-update without a manual
// Refresh -- but there's no point polling a backgrounded window (it wastes
// cycles, and macOS App-Nap throttles background timers anyway, so a paused
// timer is more honest than a silently-starved one).
//
// The window/document seam is injected (FocusPollingHost) so the gating logic
// is a pure, DOM-free unit -- tested with fakes, no jsdom or real timers. The
// React component supplies the real window/document in a one-line effect.

export interface FocusPollingHost {
  hasFocus: () => boolean;
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  addEventListener: (type: "focus" | "blur", fn: () => void) => void;
  removeEventListener: (type: "focus" | "blur", fn: () => void) => void;
}

// Start polling `tick` every `intervalMs` while focused. On regaining focus it
// ALSO ticks once immediately (don't make the user wait a full interval for a
// fresh value after returning); on blur it stops the timer. If the window is
// already focused, the timer starts immediately but does NOT tick synchronously
// -- the caller owns its initial fetch (e.g. the mount probe). Returns a cleanup
// that stops the timer and detaches the listeners. Pure given the host.
export function startFocusPolling(
  tick: () => void,
  intervalMs: number,
  host: FocusPollingHost,
): () => void {
  let id: number | null = null;
  const stop = () => {
    if (id !== null) {
      host.clearInterval(id);
      id = null;
    }
  };
  const start = () => {
    if (id === null) id = host.setInterval(tick, intervalMs);
  };
  const onFocus = () => {
    tick();
    start();
  };
  if (host.hasFocus()) start();
  host.addEventListener("focus", onFocus);
  host.addEventListener("blur", stop);
  return () => {
    stop();
    host.removeEventListener("focus", onFocus);
    host.removeEventListener("blur", stop);
  };
}
