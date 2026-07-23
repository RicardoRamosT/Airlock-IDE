import { useCallback, useEffect, useMemo, useState } from "react";
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

type Tab = "changes" | "notes";
const CHANGE_TAGS: ReadonlySet<string> = new Set(["change", "fix", "decision"]);

function matches(e: JournalEntry, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    e.text.toLowerCase().includes(s) ||
    (e.details ?? "").toLowerCase().includes(s)
  );
}

// The Changelog view of the Overview page: the project's journal, split into a
// read-only Changes tab (git-derived change/fix/decision entries) and an
// editable Notes tab, each with its own searchbar.
export function ChangelogView({ root }: { root: string }) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [tab, setTab] = useState<Tab>("changes");
  const [query, setQuery] = useState<{ changes: string; notes: string }>({
    changes: "",
    notes: "",
  });

  const load = useCallback(() => {
    void window.airlock.journalGet(root).then(setEntries);
  }, [root]);

  useEffect(() => {
    load();
    return window.airlock.onJournalChanged((e) => {
      if (e.root === root) load();
    });
  }, [load, root]);

  const q = query[tab];
  const list = useMemo(
    () =>
      (entries ?? []).filter(
        (e) =>
          (tab === "notes" ? e.tag === "note" : CHANGE_TAGS.has(e.tag)) &&
          matches(e, q),
      ),
    [entries, tab, q],
  );

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
      <div className="changelog-tabs">
        {(["changes", "notes"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`changelog-tab${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "changes" ? "Changes" : "Notes"}
          </button>
        ))}
      </div>
      <input
        className="changelog-search sb-control"
        type="search"
        placeholder={`Search ${tab}…`}
        value={q}
        onChange={(e) => setQuery((s) => ({ ...s, [tab]: e.target.value }))}
      />
      {tab === "notes" ? (
        <NotesTab root={root} notes={list} />
      ) : (
        <div className="changelog-list">
          {list.length === 0 ? (
            <div className="section-empty">No matching changes.</div>
          ) : (
            list.map((e) => <EntryRow key={`${e.ts}-${e.text}`} entry={e} />)
          )}
        </div>
      )}
    </div>
  );
}

// Placeholder read-only Notes list (CRUD lands in the next task).
function NotesTab({
  root: _root,
  notes,
}: {
  root: string;
  notes: JournalEntry[];
}) {
  return (
    <div className="changelog-list">
      {notes.length === 0 ? (
        <div className="section-empty">No notes.</div>
      ) : (
        notes.map((n) => <EntryRow key={`${n.ts}-${n.text}`} entry={n} />)
      )}
    </div>
  );
}
