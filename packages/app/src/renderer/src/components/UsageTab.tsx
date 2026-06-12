import { useEffect, useState } from "react";
import type { QuotaWindow, SessionUsage } from "../../../shared/ipc";
import {
  clampPct,
  formatCountdown,
  isWindowAwaiting,
} from "../lib/quotaFormat";
import {
  aggregateByModel,
  formatApiTime,
  formatModels,
  formatTokens,
  formatUsd,
  isSessionActive,
  visibleSessions,
} from "../lib/usageFormat";
import { useApp } from "../store";

const basename = (p: string | null): string =>
  p ? (p.split("/").pop() ?? p) : "—";

// The Usage page: an IDE-level page-tab in the PROJECT strip (App renders it
// in the workspace panes slot while appPage === "usage"). Polls usage:get
// while mounted; Esc or the tab's close button dismisses it.
export function UsageTab() {
  const closeAppPage = useApp((s) => s.closeAppPage);
  const quota = useApp((s) => s.quota);
  const [sessions, setSessions] = useState<SessionUsage[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void window.airlock
        .usageGet()
        .then((u) => {
          if (!cancelled) setSessions(u);
        })
        .catch(console.error);
    load();
    const id = setInterval(() => {
      load();
      setTick((t) => t + 1);
    }, 2000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAppPage("usage");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [closeAppPage]);

  const now = Math.floor(Date.now() / 1000);
  // Only sessions that did real work (API time / cost / edits). Drops the
  // all-zero pre-first-response blanks AND context-only ghosts -- e.g. a
  // background/forked session that loaded context but never completed a turn.
  const visible = visibleSessions(sessions);
  const models = aggregateByModel(visible);
  const totalCost = visible.reduce((a, s) => a + s.costUsd, 0);
  const totalApiMs = visible.reduce((a, s) => a + s.apiMs, 0);
  const totalAdded = visible.reduce((a, s) => a + s.linesAdded, 0);
  const totalRemoved = visible.reduce((a, s) => a + s.linesRemoved, 0);
  // "Live" = usage advanced recently, not merely re-emitted on the refresh
  // timer (an open-but-idle session keeps emitting unchanged numbers).
  const liveCount = visible.filter((s) => isSessionActive(s, now)).length;

  const windowRow = (label: string, w: QuotaWindow) => {
    const awaiting = isWindowAwaiting(w, now);
    return (
      <div className="quota-row usage-scale">
        <span className="quota-row-label">{label}</span>
        <span className="quota-bar" aria-hidden>
          <span
            className="quota-bar-fill"
            style={{ width: `${clampPct(w.usedPercentage)}%` }}
          />
        </span>
        <span className="quota-pct">{Math.round(w.usedPercentage)}%</span>
        <span className="usage-reset">
          {awaiting
            ? "starts on next use"
            : `resets ${formatCountdown(w.resetsAt - now)}`}
        </span>
      </div>
    );
  };

  return (
    <div className="usage-page">
      <div className="settings-tab-header">
        <span>Usage</span>
        <button
          type="button"
          className="viewer-close"
          title="Close usage"
          onClick={() => closeAppPage("usage")}
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
      <div className="usage-body">
        <div className="usage-kpis">
          <div className="usage-kpi">
            <span className="usage-kpi-value">{formatUsd(totalCost)}</span>
            <span className="usage-kpi-label">total cost</span>
          </div>
          <div className="usage-kpi">
            <span className="usage-kpi-value">{formatApiTime(totalApiMs)}</span>
            <span className="usage-kpi-label">API time</span>
          </div>
          <div className="usage-kpi">
            <span className="usage-kpi-value">
              +{totalAdded} −{totalRemoved}
            </span>
            <span className="usage-kpi-label">lines changed</span>
          </div>
          <div className="usage-kpi">
            <span className="usage-kpi-value">
              {liveCount}
              <span className="usage-kpi-sub">/{visible.length}</span>
            </span>
            <span className="usage-kpi-label">live sessions</span>
          </div>
        </div>
        <section className="usage-section">
          <h3>Plan windows</h3>
          {quota?.fiveHour && windowRow("5h", quota.fiveHour)}
          {quota?.sevenDay && windowRow("7d", quota.sevenDay)}
          {!quota?.available && (
            <p className="settings-note">
              No account data yet — send a message in any Claude session.
            </p>
          )}
        </section>

        <section className="usage-section">
          <h3>By model</h3>
          {models.length === 0 ? (
            <p className="settings-note">
              No sessions seen since AirLock started — open a Claude terminal.
            </p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Sessions</th>
                  <th className="num">API time</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td className="num">{m.sessions}</td>
                    <td className="num">{formatApiTime(m.apiMs)}</td>
                    <td className="num">{formatUsd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {models.length > 0 && (
            <p className="settings-note">
              Cost and API time are attributed to each session's most recent
              model. A session that switched models books its whole total to its
              final model — any other model it used is counted here but its cost
              is approximate (often $0), because the statusLine reports one
              cumulative cost per session and can't split it across models.
            </p>
          )}
        </section>

        <section className="usage-section">
          <h3>Sessions (since AirLock launched)</h3>
          {visible.length > 0 && (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Model</th>
                  <th className="num">Context</th>
                  <th className="num">API time</th>
                  <th className="num">± lines</th>
                  <th className="num">Cost</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.sessionId}>
                    <td title={s.cwd ?? undefined}>{basename(s.cwd)}</td>
                    <td>{formatModels(s)}</td>
                    <td
                      className="num"
                      title={
                        s.contextWindowSize > 0
                          ? `${Math.round((s.contextTokens / s.contextWindowSize) * 100)}% of the ${formatTokens(s.contextWindowSize)} window`
                          : undefined
                      }
                    >
                      {formatTokens(s.contextTokens)}
                    </td>
                    <td className="num">{formatApiTime(s.apiMs)}</td>
                    <td className="num">
                      +{s.linesAdded} −{s.linesRemoved}
                    </td>
                    <td className="num">{formatUsd(s.costUsd)}</td>
                    <td>
                      <span
                        className={`status-dot${isSessionActive(s, now) ? " running" : ""}`}
                        title={isSessionActive(s, now) ? "live" : "idle"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="settings-note">
          API time, lines, and costs are each Claude Code session's own
          cumulative reporting; Context is the session's current context-window
          occupancy (a snapshot, not usage). A session is shown as live only
          while its usage is still advancing — an open but idle session (or a
          background/forked one) reads as idle even though it keeps emitting.
          Sessions update on conversation activity — work done by background
          subagents shows up when its result lands in the conversation. — under
          Cost means the session reports $0 (covered by your subscription plan).
        </p>
      </div>
    </div>
  );
}
