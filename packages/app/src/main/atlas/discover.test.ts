import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { directDb } from "./dbOps";
import { discoverProjects } from "./discover";
import { probeRoots } from "./presence";
import { openAtlasDb } from "./store";

const db = () => directDb(openAtlasDb(":memory:"));

// Every root present unless a test says otherwise. Injected because these
// paths are fictional: a real stat would flag the whole registry missing.
const here = async (roots: readonly string[]) =>
  new Map(roots.map((r) => [r, "present" as const]));

it("adds a project that has only just been opened", async () => {
  // THE BUG. Discovery used to happen only inside maybeCompose, behind the
  // shouldCompose gate, so a project opened after the last debrief could not
  // appear in the settings list -- and under opt-in a project you cannot see
  // is a project you cannot enable.
  const d = db();
  const out = await discoverProjects(
    d,
    ["/p/Revaltone-Web"],
    ["/p/airlock"],
    100,
    here,
  );
  expect(out.map((p) => p.name).sort()).toEqual(["Revaltone-Web", "airlock"]);
  expect((await d.readRegistry()).length).toBe(2);
});

it("never switches off a project it re-discovers", async () => {
  // Discovery runs every time the settings list is opened, which is precisely
  // when the user is flipping switches. Losing one here would be unforgivable.
  const d = db();
  await discoverProjects(d, ["/p/a"], [], 100, here);
  await d.setProjectEnabled("/p/a", true);
  await discoverProjects(d, ["/p/a"], [], 200, here);
  const back = await d.readRegistry();
  expect(back[0]?.enabled).toBe(true);
  // lastSeenAt DOES move: seeing a project again is exactly what it records.
  expect(back[0]?.lastSeenAt).toBe(200);
});

it("keeps a project that has dropped out of recents", async () => {
  // recentFolders is capped at 10; the registry never evicts. A project that
  // ages out of recents must not vanish from the list along with it.
  const d = db();
  await discoverProjects(d, ["/p/old"], [], 100, here);
  await discoverProjects(d, ["/p/new"], [], 200, here);
  expect((await d.readRegistry()).map((p) => p.name).sort()).toEqual([
    "new",
    "old",
  ]);
});

// --- the list has to be TRUE when you look at it ------------------------

it("flags a deleted folder on the very next read, not tomorrow", async () => {
  // THE BUG this fixes. Adding was live -- open a folder and it appears at
  // once -- but only refreshPortfolio could set `missing`, and its two callers
  // are the morning compose and the chat's once-a-day snapshot. So a folder
  // deleted at noon still read as fine until the next debrief, in the very
  // list that is the configuration surface.
  const d = db();
  await discoverProjects(d, ["/p/keyview"], [], 100, here);
  expect((await d.readRegistry())[0]?.missing).toBe(false);

  const gone = async (roots: readonly string[]) =>
    new Map(roots.map((r) => [r, "gone" as const]));
  await discoverProjects(d, ["/p/keyview"], [], 200, gone);
  expect((await d.readRegistry())[0]).toMatchObject({
    missing: true,
    // Not re-stamped: a disappearance is not a sighting.
    lastSeenAt: 100,
  });
});

it("clears the flag when the folder comes back", async () => {
  const d = db();
  const gone = async (roots: readonly string[]) =>
    new Map(roots.map((r) => [r, "gone" as const]));
  await discoverProjects(d, ["/p/back"], [], 100, gone);
  expect((await d.readRegistry())[0]?.missing).toBe(true);
  await discoverProjects(d, ["/p/back"], [], 200, here);
  expect((await d.readRegistry())[0]).toMatchObject({
    missing: false,
    lastSeenAt: 200,
  });
});

it("does NOT flag a project whose folder could not be checked", async () => {
  // An unmounted drive or an ungranted macOS permission is not a deletion,
  // and flagging one drops a live project from the debrief, the spine and the
  // local-app monitor without a word.
  const d = db();
  await discoverProjects(d, ["/p/onadrive"], [], 100, here);
  const unknown = async (roots: readonly string[]) =>
    new Map(roots.map((r) => [r, "unknown" as const]));
  await discoverProjects(d, ["/p/onadrive"], [], 200, unknown);
  expect((await d.readRegistry())[0]).toMatchObject({
    missing: false,
    lastSeenAt: 100,
  });
});

it("reports a REAL deleted directory through the production probe", async () => {
  // End to end with the real filesystem and the real probeRoots, so the wiring
  // is proved rather than the stub.
  const dir = mkdtempSync(path.join(tmpdir(), "discover-"));
  const d = db();
  await discoverProjects(d, [dir], [], 100, probeRoots);
  expect((await d.readRegistry())[0]?.missing).toBe(false);

  rmSync(dir, { recursive: true, force: true });
  await discoverProjects(d, [dir], [], 200, probeRoots);
  expect((await d.readRegistry())[0]?.missing).toBe(true);
});
