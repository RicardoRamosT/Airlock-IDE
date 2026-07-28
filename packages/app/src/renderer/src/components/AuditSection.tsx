import { useCallback, useEffect, useState } from "react";
import type { AuditEntry } from "../../../shared/ipc";
import { auditLabel, auditSummary } from "../lib/auditLabels";
import { startFocusPolling } from "../lib/focusPolling";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { Loading } from "./Loading";
import { OpenFolderEmpty } from "./OpenFolderEmpty";

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
  // null = not asked yet, distinct from [] ("asked, and there are none").
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  // The result of the last chain check, or null when it has not been run. Not
  // run on mount: re-walking the whole log is work, and an unasked-for verdict
  // is not what makes the claim checkable -- being able to ask is.
  const [chain, setChain] = useState<{ ok: boolean; entries: number } | null>(
    null,
  );

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
    // Back to "not asked yet" for a NEW PROJECT only: `load` is keyed on root,
    // so this effect re-runs on a project change but NOT on a poll (the poll
    // calls `load` directly). Resetting on every poll would flash the spinner
    // every few seconds forever.
    setEntries(null);
    load();
    return startFocusPolling(load, POLL_MS, {
      hasFocus: () => document.hasFocus(),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      addEventListener: (type, fn) => window.addEventListener(type, fn),
      removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    });
  }, [load]);

  if (!root) return <OpenFolderEmpty />;
  if (entries === null) return <Loading label="Loading audit log" />;

  const verify = async () => {
    try {
      setChain(await window.airlock.auditVerify(root));
    } catch (err) {
      console.error("auditVerify failed", err);
      // A failed CHECK is not a failed chain -- saying "tampered" here would
      // accuse the log of something the app merely could not determine.
      setChain(null);
    }
  };

  return (
    <div className="audit">
      {/* Every broker operation is hash-chained; this is how you check that,
          rather than taking the README's word for it. */}
      <div className="section-toolbar">
        <button type="button" className="btn" onClick={() => void verify()}>
          Verify chain
        </button>
      </div>
      {chain && (
        <div className="section-note">
          {chain.entries === 0
            ? // True but not evidence: an empty log verifies trivially, so it
              // must not read as a pass.
              "Nothing to verify yet — the log is empty."
            : chain.ok
              ? `Chain intact — ${chain.entries} entries verified.`
              : `Chain BROKEN — ${chain.entries} entries read. The log has been edited or truncated.`}
        </div>
      )}
      {entries.length === 0 && (
        <div className="section-note">no operations yet</div>
      )}
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
