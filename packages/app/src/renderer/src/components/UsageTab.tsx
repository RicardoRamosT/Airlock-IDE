import { useEffect, useState } from "react";
import type { SessionUsage } from "../../../shared/ipc";
import { clampPct, formatCountdown } from "../lib/quotaFormat";
import {
  aggregateByModel,
  formatApiTime,
  formatTokens,
  formatUsd,
} from "../lib/usageFormat";
import { useApp } from "../store";

const LIVE_WITHIN_S = 20;
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
  // Hide sessions that have not done anything yet (a freshly started claude
  // emits before its first API response, all zeros) -- they would read as
  // confusing duplicates of the project's previous session.
  const visible = sessions.filter(
    (s) => s.totalInputTokens > 0 || s.totalOutputTokens > 0 || s.costUsd > 0,
  );
  const models = aggregateByModel(visible);
  const totalCost = visible.reduce((a, s) => a + s.costUsd, 0);
  const totalIn = visible.reduce((a, s) => a + s.totalInputTokens, 0);
  const totalOut = visible.reduce((a, s) => a + s.totalOutputTokens, 0);
  const liveCount = visible.filter(
    (s) => now - s.lastEmitAt <= LIVE_WITHIN_S,
  ).length;

  const windowRow = (label: string, pct: number, resetsAt: number) => (
    <div className="quota-row usage-scale">
      <span className="quota-row-label">{label}</span>
      <span className="quota-bar" aria-hidden>
        <span
          className="quota-bar-fill"
          style={{ width: `${clampPct(pct)}%` }}
        />
      </span>
      <span className="quota-pct">{Math.round(pct)}%</span>
      <span className="usage-reset">
        resets {formatCountdown(resetsAt - now)}
      </span>
    </div>
  );

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
            <span className="usage-kpi-value">{formatTokens(totalOut)}</span>
            <span className="usage-kpi-label">output tokens</span>
          </div>
          <div className="usage-kpi">
            <span className="usage-kpi-value">{formatTokens(totalIn)}</span>
            <span className="usage-kpi-label">input tokens</span>
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
          {quota?.fiveHour &&
            windowRow(
              "5h",
              quota.fiveHour.usedPercentage,
              quota.fiveHour.resetsAt,
            )}
          {quota?.sevenDay &&
            windowRow(
              "7d",
              quota.sevenDay.usedPercentage,
              quota.sevenDay.resetsAt,
            )}
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
                  <th className="num">Input</th>
                  <th className="num">Output</th>
                  <th className="num">Cache read</th>
                  <th className="num">Cache write</th>
                  <th className="num">API time</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td className="num">{m.sessions}</td>
                    <td className="num">{formatTokens(m.inputTokens)}</td>
                    <td className="num">{formatTokens(m.outputTokens)}</td>
                    <td className="num">{formatTokens(m.cacheReadTokens)}</td>
                    <td className="num">{formatTokens(m.cacheCreateTokens)}</td>
                    <td className="num">{formatApiTime(m.apiMs)}</td>
                    <td className="num">{formatUsd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  <th className="num">Input</th>
                  <th className="num">Output</th>
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
                    <td>{s.model ?? "unknown"}</td>
                    <td className="num">{formatTokens(s.totalInputTokens)}</td>
                    <td className="num">{formatTokens(s.totalOutputTokens)}</td>
                    <td className="num">{formatApiTime(s.apiMs)}</td>
                    <td className="num">
                      +{s.linesAdded} −{s.linesRemoved}
                    </td>
                    <td className="num">{formatUsd(s.costUsd)}</td>
                    <td>
                      <span
                        className={`status-dot${now - s.lastEmitAt <= LIVE_WITHIN_S ? " running" : ""}`}
                        title={
                          now - s.lastEmitAt <= LIVE_WITHIN_S ? "live" : "idle"
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="settings-note">
          Token counts and costs come from each Claude Code session's own
          reporting. — under Cost means the session reports $0 (covered by your
          subscription plan).
        </p>
      </div>
    </div>
  );
}
