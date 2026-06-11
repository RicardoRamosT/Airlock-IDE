import { useEffect, useState } from "react";
import { clampPct, formatCountdown } from "../lib/quotaFormat";
import { useApp } from "../store";

// Our installed statusLine re-runs every ~5s while a Claude session is open, so
// an emit older than this (a few missed ticks of jitter slack) means no session
// is currently running.
const STALE_AFTER_SECONDS = 15;

function Row({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="quota-row">
      <span className="quota-row-label">{label}</span>
      <span className="quota-bar" aria-hidden>
        <span
          className="quota-bar-fill"
          style={{ width: `${clampPct(pct)}%` }}
        />
      </span>
      <span className="quota-pct">{Math.round(pct)}%</span>
    </div>
  );
}

// Account-wide Claude subscription usage, pinned bottom-left of the sidebar.
// Renders null when disabled so the sidebar layout is unaffected. A 1s ticker
// keeps the reset countdown live between emits (no polling of main).
export function QuotaMeter() {
  const enabled = useApp((s) => s.quotaMeterEnabled);
  const quota = useApp((s) => s.quota);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const now = Math.floor(Date.now() / 1000);
  // No recent statusLine emit => no Claude session is feeding the meter; the
  // numbers would be a stale snapshot, so prompt the user instead.
  const fresh = quota !== null && now - quota.updatedAt <= STALE_AFTER_SECONDS;

  // Every state of the card is a click-through to the Usage page-tab.
  const openUsage = () => useApp.getState().openAppPage("usage");

  if (!fresh) {
    return (
      <button
        type="button"
        className="quota-meter"
        title="Open usage details"
        onClick={openUsage}
      >
        <div className="quota-title">Plan usage</div>
        <div className="quota-waiting">
          Start a Claude session to see your usage limits
        </div>
      </button>
    );
  }

  if (!quota.available) {
    // A session is active but rate limits haven't arrived yet (first response
    // pending, or an account that doesn't report them).
    return (
      <button
        type="button"
        className="quota-meter"
        title="Open usage details"
        onClick={openUsage}
      >
        <div className="quota-title">Plan usage</div>
        <div className="quota-waiting">Waiting for usage data…</div>
      </button>
    );
  }

  // Each present window gets a labeled reset countdown; the 5h and 7d windows
  // share one line — joined by " · " — so both turnovers are visible at a
  // glance. The reset line uses the words "session" / "weekly" rather than the
  // bars' "5h" / "7d": a bare "5h"/"7d" label sits right against an h/d
  // countdown ("5h 1h57m") and reads as one nonsensical duration. A weekly-only
  // status still gets its line rather than a bar with no reset time.
  const resets = [
    quota.fiveHour &&
      `session ${formatCountdown(quota.fiveHour.resetsAt - now)}`,
    quota.sevenDay &&
      `weekly ${formatCountdown(quota.sevenDay.resetsAt - now)}`,
  ].filter(Boolean);

  return (
    <button
      type="button"
      className="quota-meter"
      title={
        quota.model
          ? `${quota.model} — open usage details`
          : "Open usage details"
      }
      onClick={openUsage}
    >
      <div className="quota-title">Plan usage</div>
      {quota.fiveHour && <Row label="5h" pct={quota.fiveHour.usedPercentage} />}
      {quota.sevenDay && <Row label="7d" pct={quota.sevenDay.usedPercentage} />}
      {resets.length > 0 && (
        <div className="quota-reset">
          <i className="codicon codicon-history" /> {resets.join(" · ")}
        </div>
      )}
    </button>
  );
}
