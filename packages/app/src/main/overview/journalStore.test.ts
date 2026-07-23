import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  addNoteEntry,
  appendJournalEntry,
  deleteNoteEntry,
  readRecentJournal,
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
