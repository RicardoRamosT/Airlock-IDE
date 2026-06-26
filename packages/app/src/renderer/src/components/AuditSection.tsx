import { useCallback, useEffect, useState } from "react";
import type { AuditEntry } from "../../../shared/ipc";
import { auditLabel, auditSummary } from "../lib/auditLabels";
import { startFocusPolling } from "../lib/focusPolling";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

// Re-read cadence. Most actions (git, files, integrations) have no store signal
// to react to, so the panel polls — gently, and paused when backgrounded — so
// everything that gets audited shows up within a few seconds.
const POLL_MS = 3000;
const LIMIT = 50;

function shortTime(iso: string): string {
  return iso.slice(11, 19);
}

export function AuditSection() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  const load = useCallback(() => {
    if (!root) {
      setEntries([]);
      return;
    }
    window.airlock
      .auditRead(root, LIMIT)
      .then((e) => setEntries(e.reverse()))
      .catch(() => {});
  }, [root]);

  useEffect(() => {
    load();
    return startFocusPolling(load, POLL_MS, {
      hasFocus: () => document.hasFocus(),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      addEventListener: (type, fn) => window.addEventListener(type, fn),
      removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    });
  }, [load]);

  if (!root) return <div className="section-note">open a folder first</div>;
  if (entries.length === 0)
    return <div className="section-note">no operations yet</div>;

  return (
    <div className="audit">
      {entries.map((e) => {
        const { label, icon } = auditLabel(e.op);
        const summary = auditSummary(e.detail);
        return (
          <div
            key={e.hash}
            className="audit-row"
            title={`${e.op} ${JSON.stringify(e.detail)}`}
          >
            <i
              className={`codicon codicon-${e.actor === "agent" ? "hubot" : "account"} audit-actor audit-actor--${e.actor}`}
              title={e.actor === "agent" ? "Claude" : "you"}
            />
            <i className={`codicon codicon-${icon} audit-icon`} />
            <span className="audit-op">{label}</span>
            {summary && <span className="audit-detail">{summary}</span>}
            <span className="audit-time">{shortTime(e.ts)}</span>
          </div>
        );
      })}
    </div>
  );
}
