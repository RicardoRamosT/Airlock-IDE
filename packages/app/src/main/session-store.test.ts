import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { SessionSnapshot } from "../shared/ipc";
import { readSession, writeSession } from "./session-store";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "airlock-session-"));
  file = path.join(dir, "session.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SNAP: SessionSnapshot = {
  version: 1,
  tabs: [
    { root: "/a", hadClaude: true },
    { root: "/b", hadClaude: false },
  ],
  activeRoot: "/a",
  split: { a: "/a", b: "/b" },
};

it("write then read round-trips the snapshot", async () => {
  await writeSession(file, SNAP);
  expect(await readSession(file)).toEqual(SNAP);
});

it("absent file reads as null", async () => {
  expect(await readSession(file)).toBeNull();
});

it("malformed JSON reads as null (never throws)", async () => {
  await writeFile(file, "{not json", "utf8");
  expect(await readSession(file)).toBeNull();
});

it("wrong version reads as null", async () => {
  await writeFile(file, JSON.stringify({ ...SNAP, version: 2 }), "utf8");
  expect(await readSession(file)).toBeNull();
});

it("writeSession is best-effort: a bad path does not throw", async () => {
  // a path whose parent is a FILE cannot be created -> write fails internally
  await writeFile(file, "x", "utf8");
  await expect(
    writeSession(path.join(file, "nope.json"), SNAP),
  ).resolves.toBeUndefined();
});
