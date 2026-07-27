import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  clampPct,
  formatCountdown,
  isWindowAwaiting,
  quotaFillColor,
  STALE_AFTER_SECONDS,
  wingCountdown,
} from "../lib/quotaFormat";
import { useApp } from "../store";

// One wing of the titlebar gauge: a fixed-width track whose fill grows toward the
// title card, with the percentage centered on it. `side` decides which edge the
// fill anchors to, so the pair reads as one symmetrical HUD around the title.
// Always the same size -- an empty track when there is no data -- so the title
// card never shifts as usage arrives or goes stale.
//
// `icon` is what tells the two windows apart without a text caption: a clock for
// the rolling 5-hour session, a calendar for the 7-day week. (Tick marks encoding
// the window length were tried first and read as clutter across the track.)
function Wing({
  side,
  pct,
  reset,
  icon,
  label,
  title,
  onClick,
}: {
  side: "left" | "right";
  pct: number | null;
  reset: string;
  icon: "clock" | "calendar";
  label: string;
  title: string;
  onClick: () => void;
}) {
  const shown = pct === null ? "—" : `${Math.round(pct)}%`;
  // The marker sits OUTSIDE the gauge box -- far left for the session, far right for
  // the week -- so it never competes with the fill or the percentage. It stays
  // inside the button so clicking it still opens the Usage page; the border and the
  // fill clip live on the inner track, which is what keeps the icon outside the box
  // while the track still butts flush against the title card.
  const mark = (
    <i
      className={`codicon codicon-${icon} titlebar-wing-icon`}
      aria-hidden="true"
    />
  );
  const track = (
    <span className="titlebar-wing-track">
      {pct !== null && (
        <i
          className="titlebar-wing-fill"
          style={{
            width: `${clampPct(pct)}%`,
            // Continuous blue -> yellow -> red, so the colour tracks the number
            // rather than jumping at a threshold.
            ["--wing-tone" as string]: quotaFillColor(pct),
          }}
        />
      )}
      {/* Percentage anchored OUTWARD (beside its clock/calendar marker) and the
          countdown INWARD, so the two countdowns flank the title and the two
          percentages sit at the extremes. Both fit the 92px track because the
          countdown is the short form ("3h13m", "2d 4h"). */}
      <span className="titlebar-wing-num">
        <span className="titlebar-wing-pct">{shown}</span>
        {reset && <span className="titlebar-wing-reset">{reset}</span>}
      </span>
    </span>
  );
  return (
    <button
      type="button"
      className={`titlebar-wing ${side}${pct === null ? " is-idle" : ""}`}
      title={title}
      aria-label={`${label} ${pct === null ? "no data yet" : shown} — open usage details`}
      onClick={onClick}
    >
      {side === "left" ? mark : null}
      {track}
      {side === "right" ? mark : null}
    </button>
  );
}

// Claude subscription usage fused into the titlebar, flanking the project title:
// 5-hour on the left, 7-day on the right. It lives here rather than at the bottom
// of the sidebar so it stays visible when the sidebar is collapsed (and so the
// sidebar gets its 88px dock back). Each wing is a button opening the Usage
// page-tab -- the same click-through the sidebar meter had -- while the title
// card between them stays deliberately non-interactive.
//
// Renders the centering group around `children` (the title card) in every state,
// so the title stays centered whether or not the wings are shown. The titlebar row
// is a FIXED 38px (.app-shell grid), so this can never grow the titlebar or crowd
// the project tabs below.
export function TitleQuota({ children }: { children: ReactNode }) {
  const enabled = useApp((s) => s.quotaMeterEnabled);
  const quota = useApp((s) => s.quota);
  const [, setTick] = useState(0);

  // 1s ticker keeps the reset countdown in the tooltip live between emits.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return <div className="titlebar-center">{children}</div>;

  const now = Math.floor(Date.now() / 1000);
  const fresh = quota !== null && now - quota.updatedAt <= STALE_AFTER_SECONDS;
  const live = fresh && quota.available ? quota : null;
  const five = live?.fiveHour ?? null;
  const seven = live?.sevenDay ?? null;

  // The tooltip keeps the FULL phrasing ("session starts on next use"); the
  // gauge itself shows the short form. Same facts, two levels of detail.
  const resets = [
    five &&
      (isWindowAwaiting(five, now)
        ? "session starts on next use"
        : `session ${formatCountdown(five.resetsAt - now)}`),
    seven &&
      (isWindowAwaiting(seven, now)
        ? "weekly starts on next use"
        : `weekly ${formatCountdown(seven.resetsAt - now)}`),
  ].filter(Boolean);

  const title = !fresh
    ? "Start a Claude session to see your usage limits — click for usage details"
    : !quota.available
      ? "Waiting for usage data… — click for usage details"
      : [quota.model, ...resets].filter(Boolean).join(" · ");

  const openUsage = () => useApp.getState().openAppPage("usage");

  return (
    <div className="titlebar-center">
      <Wing
        side="left"
        icon="clock"
        pct={five ? five.usedPercentage : null}
        reset={wingCountdown(five, now)}
        label="5-hour usage"
        title={title}
        onClick={openUsage}
      />
      {children}
      <Wing
        side="right"
        icon="calendar"
        pct={seven ? seven.usedPercentage : null}
        reset={wingCountdown(seven, now)}
        label="7-day usage"
        title={title}
        onClick={openUsage}
      />
    </div>
  );
}
