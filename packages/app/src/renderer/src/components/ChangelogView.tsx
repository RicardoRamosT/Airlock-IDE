import { useCallback, useEffect, useState } from "react";
import type { JournalEntry } from "../../../shared/ipc";
import { relativeTime } from "../lib/overviewFreshness";
import { OverviewMarkdown } from "./OverviewMarkdown";

// One Changelog row: title + tag + time, with an optional expand toggle that
// reveals the markdown `details` (rendered by the safe OverviewMarkdown).
function EntryRow({ entry }: { entry: JournalEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="changelog-entry">
      <div className="changelog-meta">
        <span className={`changelog-tag tag-${entry.tag}`}>{entry.tag}</span>
        <span className="changelog-time">
          {relativeTime(entry.ts, Date.now())}
        </span>
      </div>
      <div className="changelog-text">
        {entry.text}
        {entry.details ? (
          <button
            type="button"
            className="changelog-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▾ hide" : "▸ details"}
          </button>
        ) : null}
      </div>
      {entry.details && open ? (
        <div className="changelog-details">
          <OverviewMarkdown md={entry.details} />
        </div>
      ) : null}
    </div>
  );
}

// The Changelog view of the Overview page: the project's append-only journal
// (written by add_changelog_entry), newest-first. Read-only in v1.
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
        <EntryRow key={`${e.ts}-${e.text}`} entry={e} />
      ))}
    </div>
  );
}
