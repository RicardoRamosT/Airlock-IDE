import { useEffect, useState } from "react";
import { clampPct, formatCountdown } from "../lib/quotaFormat";
import { useApp } from "../store";

// Our installed statusLine re-runs every ~10s while a Claude session is open,
// so a side-channel emit older than this means no session is currently running.
const STALE_AFTER_SECONDS = 40;

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

  if (!fresh) {
    return (
      <div className="quota-meter">
        <div className="quota-title">Plan usage</div>
        <div className="quota-waiting">
          Start a Claude session to see your usage limits
        </div>
      </div>
    );
  }

  if (!quota.available) {
    // A session is active but rate limits haven't arrived yet (first response
    // pending, or an account that doesn't report them).
    return (
      <div className="quota-meter">
        <div className="quota-title">Plan usage</div>
        <div className="quota-waiting">Waiting for usage data…</div>
      </div>
    );
  }

  return (
    <div className="quota-meter" title={quota.model ?? undefined}>
      <div className="quota-title">Plan usage</div>
      {quota.fiveHour && <Row label="5h" pct={quota.fiveHour.usedPercentage} />}
      {quota.sevenDay && <Row label="7d" pct={quota.sevenDay.usedPercentage} />}
      {quota.fiveHour && (
        <div
          className="quota-reset"
          title={
            quota.sevenDay
              ? `7-day resets in ${formatCountdown(quota.sevenDay.resetsAt - now)}`
              : undefined
          }
        >
          <i className="codicon codicon-history" /> resets{" "}
          {formatCountdown(quota.fiveHour.resetsAt - now)}
        </div>
      )}
    </div>
  );
}
