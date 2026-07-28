import { useCallback, useEffect, useMemo, useState } from "react";
import type { JournalEntry } from "../../../shared/ipc";
import { relativeTime } from "../lib/overviewFreshness";
import { useApp } from "../store";
import { Loading } from "./Loading";
import { OverviewMarkdown } from "./OverviewMarkdown";

// Single-line prompt (no newline -> pasted into Claude's input, NOT submitted,
// so the user reviews then presses Enter) that asks Claude to seed the changelog
// from git history. Points at the BULK tool (seeding is inherently many entries,
// and looping the single-entry tool costs one call + a whole-file rewrite each)
// and asks for each commit's real date via `ts`, so the seeded history is dated
// correctly instead of collapsing onto "now".
const SEED_CHANGELOG_PROMPT =
  "Please populate this project's changelog: review the git history and record every notable change with the add_changelog_entries tool, batching them in as few calls as possible (it takes an array; do NOT call add_changelog_entry once per entry). For each entry give a concise title, the right tag (change/fix/decision/note), a markdown details body explaining the why and what, and `ts` set to that commit's date in epoch milliseconds so the history keeps its real dates.";

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
    return <Loading label="Loading changelog" size="page" />;
  if (entries.length === 0) {
    return (
      <div className="overview empty">
        <div className="changelog-empty">
          <i className="codicon codicon-book changelog-empty-icon" />
          <h3 className="changelog-empty-title">No changelog yet</h3>
          <p className="changelog-empty-text">
            Let Claude document this project&rsquo;s history — it&rsquo;ll
            review the git log and add an entry for each notable change.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const s = useApp.getState();
              const tabId = s.tabs.find((t) => t.root === root)?.id;
              if (s.sendToClaudeTerminal(SEED_CHANGELOG_PROMPT, tabId))
                s.closeOverview(); // reveal the terminal with the pasted prompt
            }}
          >
            Ask Claude to write the changelog
          </button>
          <p className="changelog-empty-hint">
            Claude also records changes anytime with{" "}
            <code>add_changelog_entry</code> (or{" "}
            <code>add_changelog_entries</code> for many at once).
          </p>
        </div>
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

// Add/edit form for a note: a title + optional markdown details.
function NoteComposer({
  initial,
  onSave,
  onCancel,
}: {
  initial?: JournalEntry;
  onSave: (text: string, details: string | undefined) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  return (
    <div className="note-composer">
      <input
        className="sb-control"
        placeholder="Title"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <textarea
        className="note-details-input"
        placeholder="Details (markdown, optional)"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
      />
      <div className="note-composer-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={text.trim() === ""}
          onClick={() => onSave(text.trim(), details.trim() || undefined)}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// A single editable note row: expandable details + Edit / Delete (delete
// asks an inline confirm first).
function NoteRow({
  note,
  onEdit,
  onDelete,
}: {
  note: JournalEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="changelog-entry">
      <div className="changelog-meta">
        <span className="changelog-tag tag-note">note</span>
        <span className="changelog-time">
          {relativeTime(note.ts, Date.now())}
        </span>
        <span className="note-actions">
          <button type="button" className="note-action" onClick={onEdit}>
            Edit
          </button>
          {confirming ? (
            <>
              <button type="button" className="note-action" onClick={onDelete}>
                Confirm
              </button>
              <button
                type="button"
                className="note-action"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="note-action"
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          )}
        </span>
      </div>
      <div className="changelog-text">
        {note.text}
        {note.details ? (
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
      {note.details && open ? (
        <div className="changelog-details">
          <OverviewMarkdown md={note.details} />
        </div>
      ) : null}
    </div>
  );
}

// The Notes tab: an add-note composer plus editable/deletable note rows.
function NotesTab({ root, notes }: { root: string; notes: JournalEntry[] }) {
  const [adding, setAdding] = useState(false);
  const [editingTs, setEditingTs] = useState<number | null>(null);
  return (
    <div className="notes-tab">
      {adding ? (
        <NoteComposer
          onCancel={() => setAdding(false)}
          onSave={(text, details) => {
            void window.airlock.journalAddNote(root, text, details);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          ＋ Add note
        </button>
      )}
      <div className="changelog-list">
        {notes.length === 0 ? (
          <div className="section-empty">No notes.</div>
        ) : (
          notes.map((n) =>
            editingTs === n.ts ? (
              <NoteComposer
                key={n.ts}
                initial={n}
                onCancel={() => setEditingTs(null)}
                onSave={(text, details) => {
                  void window.airlock.journalUpdateNote(
                    root,
                    n.ts,
                    text,
                    details,
                  );
                  setEditingTs(null);
                }}
              />
            ) : (
              <NoteRow
                key={n.ts}
                note={n}
                onEdit={() => setEditingTs(n.ts)}
                onDelete={() => {
                  void window.airlock.journalDeleteNote(root, n.ts);
                }}
              />
            ),
          )
        )}
      </div>
    </div>
  );
}
