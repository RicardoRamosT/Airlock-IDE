import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityItem, ActivityStep } from "../../../shared/ipc";

function dotClass(state: ActivityItem["state"]): string {
  if (state === "done") return "status-dot on";
  if (state === "failed") return "status-dot fail";
  if (state === "running") return "status-dot running";
  return "status-dot";
}

function stepIcon(s: ActivityStep): string {
  if (s.status !== "completed") {
    return s.status === "in_progress"
      ? "codicon-sync step-spin"
      : "codicon-circle-outline";
  }
  if (s.conclusion === "success") return "codicon-check step-ok";
  if (s.conclusion === "skipped" || s.conclusion === "neutral")
    return "codicon-dash";
  return "codicon-error step-fail";
}

export function ActivitySection() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const list = await window.airlock.activityStatus();
      if (mounted.current) {
        setItems(list);
        setLoaded(true);
      }
    } catch (err) {
      console.error("activityStatus failed", err);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  // Mount fetch (the section just expanded) + refresh on window focus.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // A dismiss in ANY window (or the agent's MCP tool) broadcasts activity:changed;
  // refetch so the dismissed entry disappears here live.
  useEffect(
    () => window.airlock.onActivityChanged(() => void refresh()),
    [refresh],
  );

  // Poll every 3s while something is running; stop when all idle. Collapsing the
  // section unmounts this component, so the timer is torn down automatically.
  const anyRunning = items.some((i) => i.state === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [anyRunning, refresh]);

  // Dismiss every currently-shown finished entry (done/failed). Reuses the
  // per-entry dismiss path -- no new IPC; the broadcast refetches the list.
  const finished = items.filter(
    (i) => i.state === "done" || i.state === "failed",
  );
  const clearFinished = () => {
    for (const i of finished) void window.airlock.activityDismiss(i.id);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="activity">
      <div className="db-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => void refresh()}
          disabled={busy}
          title="Refresh activity"
        >
          ↻ Refresh
        </button>
        {finished.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={clearFinished}
            title="Dismiss all finished entries"
          >
            Clear finished
          </button>
        )}
      </div>
      {!loaded && <div className="section-note">Loading…</div>}
      {loaded && items.length === 0 && (
        <div className="section-note">Nothing active</div>
      )}
      {items.map((item) => {
        const hasSteps = item.kind === "ci" && (item.steps?.length ?? 0) > 0;
        const isOpen = expanded.has(item.id);
        return (
          <div key={item.id} className="activity-item">
            {/* A row is an expander only when it has steps; it must stay a div
                (not a <button>) because it nests the href link button. Keyboard
                access is provided explicitly via role/tabIndex/onKeyDown. */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: expandable row carries role=button + onKeyDown; div is required to nest the link button */}
            <div
              className="activity-row"
              role={hasSteps ? "button" : undefined}
              tabIndex={hasSteps ? 0 : undefined}
              onClick={hasSteps ? () => toggle(item.id) : undefined}
              onKeyDown={
                hasSteps
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(item.id);
                      }
                    }
                  : undefined
              }
            >
              <span className={dotClass(item.state)} />
              <span className="activity-title">{item.title}</span>
              <span className="activity-sub">{item.subtitle}</span>
              {item.href && (
                <button
                  type="button"
                  className="activity-link"
                  title="Open on GitHub"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.href)
                      void window.airlock.hostOpenExternal(item.href);
                  }}
                >
                  ↗
                </button>
              )}
              <button
                type="button"
                className="activity-dismiss"
                title="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  void window.airlock.activityDismiss(item.id);
                }}
              >
                <i className="codicon codicon-close" />
              </button>
            </div>
            {item.progress && (
              <div
                className={
                  item.progress.kind === "indeterminate"
                    ? "progress-bar indeterminate"
                    : "progress-bar"
                }
              >
                <div
                  className="fill"
                  style={
                    item.progress.kind === "determinate"
                      ? { width: `${item.progress.value}%` }
                      : undefined
                  }
                />
              </div>
            )}
            {item.progress?.kind === "determinate" && (
              <div className="activity-progress-label">
                {item.progress.label}
              </div>
            )}
            {hasSteps && isOpen && (
              <div className="step-list">
                {item.steps?.map((s, i) => (
                  // Step names can repeat across a run; index disambiguates and
                  // the step order is fixed for one fetch, so position is stable.
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable step order per fetch
                  <div key={`${s.name}-${i}`} className="step-row">
                    <i className={`codicon ${stepIcon(s)}`} />
                    <span className="step-name">{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
