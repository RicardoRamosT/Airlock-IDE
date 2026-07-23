import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { appendJournalEntry, readRecentJournal } from "./journalStore";

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
