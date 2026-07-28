import { useEffect, useState } from "react";
import type {
  MemorySample,
  QuotaWindow,
  SessionUsage,
} from "../../../shared/ipc";
import {
  formatBytes,
  kindLabel,
  type SortCol,
  sortProcs,
} from "../lib/memoryFormat";
import {
  clampPct,
  formatCountdown,
  isWindowAwaiting,
} from "../lib/quotaFormat";
import {
  aggregateByModel,
  costLabel,
  formatApiTime,
  formatModels,
  formatTokens,
  isSessionActive,
  visibleSessions,
} from "../lib/usageFormat";
import { useApp } from "../store";

import { Loading } from "./Loading";

const basename = (p: string | null): string =>
  p ? (p.split("/").pop() ?? p) : "—";

// The Usage page: an IDE-level page-tab in the PROJECT strip (App renders it
// in the workspace panes slot while appPage === "usage"). Polls usage:get
// while mounted; Esc or the tab's close button dismisses it.
export function UsageTab() {
  const closeAppPage = useApp((s) => s.closeAppPage);
  const quota = useApp((s) => s.quota);
  // null = not asked yet, distinct from [] ("asked, and there are no sessions
  // on this machine"). The page used to paint its empty tables while both
  // fetches were still out.
  const [sessions, setSessions] = useState<SessionUsage[] | null>(null);
  const [memory, setMemory] = useState<MemorySample | null>(null);
  const [memSort, setMemSort] = useState<{ col: SortCol; dir: "asc" | "desc" }>(
    { col: "footprint", dir: "desc" },
  );
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void window.airlock
        .usageGet()
        .then((u) => {
          if (!cancelled) setSessions(u);
        })
        .catch(console.error);
      void window.airlock
        .memoryGet()
        .then((m) => {
          if (!cancelled) setMemory(m);
        })
        .catch(console.error);
    };
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
  // `?? []` rather than moving these below the loading gate: they are cheap
  // pure derivations, and hoisting the gate above them would put an early
  // return between the hooks and the render body.
  const visible = visibleSessions(sessions ?? []);
  const models = aggregateByModel(visible);
  const totalCost = visible.reduce((a, s) => a + s.costUsd, 0);
  const totalApiMs = visible.reduce((a, s) => a + s.apiMs, 0);
  const totalAdded = visible.reduce((a, s) => a + s.linesAdded, 0);
  const totalRemoved = visible.reduce((a, s) => a + s.linesRemoved, 0);
  // rate_limits present => a Pro/Max subscription, where the reported cost is
  // the pay-as-you-go EQUIVALENT (not billed). Drives every cost label below.
  // (Per-session liveness stays as the Active dot in the Sessions table, keyed
  // off isSessionActive -- no aggregate "live count", which read as broken.)
  const onSubscription = quota?.available === true;

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

  // Both first-paint fetches, or neither: the ledger and the process sample
  // feed different tables on the same page, so landing them separately is the
  // popping this replaces. Never reset by the 2s poll.
  if (sessions === null || memory === null) {
    return (
      <div className="usage-page">
        <Loading label="Loading usage" size="page" />
      </div>
    );
  }

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
            <span className="usage-kpi-value">{visible.length}</span>
            <span className="usage-kpi-label">sessions</span>
          </div>
          <div className="usage-kpi usage-kpi-muted">
            <span className="usage-kpi-value">
              {costLabel(totalCost, onSubscription)}
            </span>
            <span className="usage-kpi-label">
              {onSubscription ? "API-equivalent · not billed" : "total cost"}
            </span>
          </div>
        </div>
        <section className="usage-section">
          <h3>Plan windows</h3>
          {quota?.fiveHour && windowRow("5h", quota.fiveHour)}
          {quota?.sevenDay && windowRow("7d", quota.sevenDay)}
          {!quota?.available && (
            <p className="settings-note">
              No account data yet. Send a message in any Claude session.
            </p>
          )}
        </section>

        <section className="usage-section">
          <h3>By model</h3>
          {models.length === 0 ? (
            <p className="settings-note">
              No sessions recorded yet. Open a Claude terminal.
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
                    <td className="num">
                      {costLabel(m.costUsd, onSubscription)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {models.length > 0 && (
            <p className="settings-note">
              Cost and API time are attributed to each session's most recent
              model. A session that switched models books its whole total to its
              final model. Any other model it used is counted here, but its cost
              is approximate (often $0), because the statusLine reports one
              cumulative cost per session and can't split it across models.
              {onSubscription &&
                " On your subscription the cost is the pay-as-you-go equivalent, not money billed."}
            </p>
          )}
        </section>

        <section className="usage-section">
          <h3>Recent sessions</h3>
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
                    <td className="num">
                      {costLabel(s.costUsd, onSubscription)}
                    </td>
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

        <section className="usage-section">
          <h3>Memory (AirLock + children)</h3>
          {memory?.available ? (
            <>
              <div className="usage-kpis">
                <div className="usage-kpi">
                  <span className="usage-kpi-value">
                    {formatBytes(memory.total)}
                  </span>
                  <span className="usage-kpi-label">AirLock total</span>
                </div>
              </div>
              <table className="usage-table">
                <thead>
                  <tr>
                    {(
                      [
                        ["pid", "PID"],
                        ["kind", "Kind"],
                        ["project", "Project"],
                        ["footprint", "Footprint"],
                      ] as [SortCol, string][]
                    ).map(([col, label]) => (
                      <th
                        key={col}
                        className={
                          col === "footprint" || col === "pid"
                            ? "num"
                            : undefined
                        }
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          setMemSort((s) =>
                            s.col === col
                              ? { col, dir: s.dir === "asc" ? "desc" : "asc" }
                              : {
                                  col,
                                  dir: col === "footprint" ? "desc" : "asc",
                                },
                          )
                        }
                      >
                        {label}
                        {memSort.col === col
                          ? memSort.dir === "asc"
                            ? " ↑"
                            : " ↓"
                          : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortProcs(memory.procs, memSort.col, memSort.dir).map(
                    (p) => (
                      <tr key={p.pid}>
                        <td className="num">{p.pid === -1 ? "—" : p.pid}</td>
                        <td>{kindLabel(p.kind)}</td>
                        <td>{p.pid === -1 ? p.name : (p.project ?? "—")}</td>
                        <td className="num">{formatBytes(p.footprint)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <p className="settings-note">
                Physical memory footprint (matches Activity Monitor). Claude
                sessions and language servers are child processes AirLock spawns
                inside its terminals; macOS bills their memory to AirLock.
              </p>
            </>
          ) : (
            <p className="settings-note">Memory breakdown unavailable</p>
          )}
        </section>

        <ul className="usage-note-list">
          <li>
            Figures come straight from each Claude session's own reporting (the
            statusLine). AirLock does not estimate them.
          </li>
          <li>
            On a subscription, the cost shown is the pay-as-you-go equivalent,
            not what you're charged.
          </li>
          <li>
            API time, lines, and cost are each session's cumulative reporting.
            Context is the session's current context-window occupancy (a
            snapshot, not usage).
          </li>
          <li>
            A session shows as live only while its usage is still advancing. An
            open but idle session (or a background or forked one) reads as idle
            even though it keeps emitting.
          </li>
          <li>
            Sessions update on conversation activity, so work done by background
            subagents appears when its result lands in the conversation.
          </li>
          <li>
            Cost shows a dash when the session reports $0 (covered by your
            subscription plan).
          </li>
        </ul>
      </div>
    </div>
  );
}
