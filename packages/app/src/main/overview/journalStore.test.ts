import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MAX_BULK } from "./journal";
import {
  addNoteEntry,
  appendJournalEntries,
  appendJournalEntry,
  deleteNoteEntry,
  readRecentJournal,
  updateNoteEntries,
  updateNoteEntry,
} from "./journalStore";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "journal-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

it("appends, reads back newest-first, defaults tag", async () => {
  expect((await appendJournalEntry(root, "first", "change", 1000)).ok).toBe(
    true,
  );
  await appendJournalEntry(root, "second", undefined, 2000);
  const recent = await readRecentJournal(root, 10);
  expect(recent.map((e) => e.text)).toEqual(["second", "first"]);
  expect(recent[0]?.tag).toBe("note"); // undefined tag -> note
  expect(recent[1]?.tag).toBe("change");
});

it("refuses empty text", async () => {
  expect((await appendJournalEntry(root, "   ", "note", 1000)).ok).toBe(false);
});

it("missing journal reads as empty", async () => {
  expect(await readRecentJournal(root, 10)).toEqual([]);
});

it("stores and reads back details", async () => {
  await appendJournalEntry(root, "title", "change", 1000, "the **why**");
  const [e] = await readRecentJournal(root, 1);
  expect(e?.text).toBe("title");
  expect(e?.details).toBe("the **why**");
});

it("addNoteEntry appends a note (unique ts) and reads back", async () => {
  const r = await addNoteEntry(root, "my note", "the **why**", 1000);
  expect(r.ok).toBe(true);
  const [e] = await readRecentJournal(root, 1);
  expect(e?.tag).toBe("note");
  expect(e?.text).toBe("my note");
  expect(e?.details).toBe("the **why**");
});

it("updateNoteEntry edits an existing note", async () => {
  await addNoteEntry(root, "before", undefined, 1000);
  const [e0] = await readRecentJournal(root, 1);
  expect((await updateNoteEntry(root, e0?.ts ?? 0, "after", "ctx")).ok).toBe(
    true,
  );
  const [e1] = await readRecentJournal(root, 1);
  expect(e1?.text).toBe("after");
  expect(e1?.details).toBe("ctx");
});

it("deleteNoteEntry removes a note", async () => {
  await addNoteEntry(root, "temp", undefined, 1000);
  const [e0] = await readRecentJournal(root, 1);
  expect((await deleteNoteEntry(root, e0?.ts ?? 0)).ok).toBe(true);
  expect(await readRecentJournal(root, 10)).toEqual([]);
});

it("update/deleteNoteEntry refuse a non-note entry (Changes immutable)", async () => {
  await appendJournalEntry(root, "shipped X", "change", 1000);
  const [c] = await readRecentJournal(root, 1);
  expect((await updateNoteEntry(root, c?.ts ?? 0, "hack")).ok).toBe(false);
  expect((await deleteNoteEntry(root, c?.ts ?? 0)).ok).toBe(false);
  expect((await readRecentJournal(root, 1))[0]?.text).toBe("shipped X");
});

it("bulk-appends a batch, reads back newest-first, and keeps ts unique", async () => {
  // The real use case: populate a Changelog in ONE call instead of 80.
  const items = Array.from({ length: 80 }, (_, i) => ({
    text: `entry ${i}`,
    tag: i % 2 ? ("fix" as const) : ("change" as const),
  }));
  const r = await appendJournalEntries(root, items, 5000);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  expect(r.added).toBe(80);
  expect(r.skipped).toBe(0);

  const all = await readRecentJournal(root, 200);
  expect(all).toHaveLength(80);
  expect(new Set(all.map((e) => e.ts)).size).toBe(80); // every key distinct
  expect(all[0]?.text).toBe("entry 79"); // newest-first
});

it("bulk-append preserves explicit historical ts and stores chronologically", async () => {
  await appendJournalEntries(
    root,
    [
      { text: "march", ts: 3000 },
      { text: "january", ts: 1000 },
      { text: "february", ts: 2000 },
    ],
    9999,
  );
  const all = await readRecentJournal(root, 10);
  // newest-first by DATE, even though they arrived out of order
  expect(all.map((e) => e.text)).toEqual(["march", "february", "january"]);
  expect(all.map((e) => e.ts)).toEqual([3000, 2000, 1000]);
});

it("bulk-append merges with existing entries and skips invalid rows", async () => {
  await appendJournalEntry(root, "existing", "note", 1000);
  const r = await appendJournalEntries(
    root,
    [{ text: "good" }, { text: "  " }],
    2000,
  );
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  expect(r.added).toBe(1);
  expect(r.skipped).toBe(1);
  expect((await readRecentJournal(root, 10)).map((e) => e.text)).toEqual([
    "good",
    "existing",
  ]);
});

it("bulk-append rejects a non-array, an empty batch, an all-invalid batch, and an oversize one", async () => {
  expect(await appendJournalEntries(root, "nope", 1)).toMatchObject({
    ok: false,
  });
  expect(await appendJournalEntries(root, [], 1)).toMatchObject({ ok: false });
  expect(await appendJournalEntries(root, [{ text: " " }], 1)).toMatchObject({
    ok: false,
  });
  const tooMany = Array.from({ length: MAX_BULK + 1 }, () => ({ text: "x" }));
  expect(await appendJournalEntries(root, tooMany, 1)).toMatchObject({
    ok: false,
  });
  expect(await readRecentJournal(root, 10)).toEqual([]); // nothing written
});

it("bulk-updates notes by ts, skipping read-only Changes rows", async () => {
  await appendJournalEntries(
    root,
    [
      { text: "n1", tag: "note", ts: 1000 },
      { text: "c", tag: "change", ts: 2000 },
      { text: "n2", tag: "note", ts: 3000 },
    ],
    9999,
  );
  const r = await updateNoteEntries(root, [
    { ts: 1000, text: "N1", details: "why" },
    { ts: 2000, text: "hack" }, // a change is immutable -> skipped
    { ts: 3000, text: "N2" },
  ]);
  expect(r).toMatchObject({ ok: true, updated: 2, skipped: 1 });
  const all = await readRecentJournal(root, 10);
  expect(all.map((e) => e.text)).toEqual(["N2", "c", "N1"]);
  expect(all.find((e) => e.ts === 1000)?.details).toBe("why");
});

it("bulk-update errors when nothing matched and leaves the file alone", async () => {
  await appendJournalEntry(root, "keep", "note", 1000);
  expect(await updateNoteEntries(root, [{ ts: 42, text: "x" }])).toMatchObject({
    ok: false,
  });
  expect(await updateNoteEntries(root, [])).toMatchObject({ ok: false });
  expect((await readRecentJournal(root, 10)).map((e) => e.text)).toEqual([
    "keep",
  ]);
});
