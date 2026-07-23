import { useCallback, useEffect, useState } from "react";
import type { JournalEntry } from "../../../shared/ipc";
import { relativeTime } from "../lib/overviewFreshness";

// The Changelog view of the Overview page: the project's append-only journal
// (written by the add_changelog_entry MCP tool), newest-first. Read-only in v1.
export function ChangelogView({ root }: { root: string }) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);

  const load = useCallback(() => {
    void window.airlock.journalGet(root).then(setEntries);
  }, [root]);

  useEffect(() => {
    load();
    return window.airlock.onJournalChanged((e) => {
      if (e.root === root) load();
    });
  }, [load, root]);

  if (entries === null)
    return <div className="overview empty">Loading&hellip;</div>;
  if (entries.length === 0) {
    return (
      <div className="overview empty">
        No changelog entries yet — Claude adds them with{" "}
        <code>add_changelog_entry</code>.
      </div>
    );
  }
  return (
    <div className="changelog">
      {entries.map((e) => (
        <div key={`${e.ts}-${e.text}`} className="changelog-entry">
          <div className="changelog-meta">
            <span className={`changelog-tag tag-${e.tag}`}>{e.tag}</span>
            <span className="changelog-time">
              {relativeTime(e.ts, Date.now())}
            </span>
          </div>
          <div className="changelog-text">{e.text}</div>
        </div>
      ))}
    </div>
  );
}
