import { expect, it } from "vitest";
import { directDb } from "./dbOps";
import { discoverProjects } from "./discover";
import { openAtlasDb } from "./store";

const db = () => directDb(openAtlasDb(":memory:"));

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
  );
  expect(out.map((p) => p.name).sort()).toEqual(["Revaltone-Web", "airlock"]);
  expect((await d.readRegistry()).length).toBe(2);
});

it("never switches off a project it re-discovers", async () => {
  // Discovery runs every time the settings list is opened, which is precisely
  // when the user is flipping switches. Losing one here would be unforgivable.
  const d = db();
  await discoverProjects(d, ["/p/a"], [], 100);
  await d.setProjectEnabled("/p/a", true);
  await discoverProjects(d, ["/p/a"], [], 200);
  const back = await d.readRegistry();
  expect(back[0]?.enabled).toBe(true);
  // lastSeenAt DOES move: seeing a project again is exactly what it records.
  expect(back[0]?.lastSeenAt).toBe(200);
});

it("keeps a project that has dropped out of recents", async () => {
  // recentFolders is capped at 10; the registry never evicts. A project that
  // ages out of recents must not vanish from the list along with it.
  const d = db();
  await discoverProjects(d, ["/p/old"], [], 100);
  await discoverProjects(d, ["/p/new"], [], 200);
  expect((await d.readRegistry()).map((p) => p.name).sort()).toEqual([
    "new",
    "old",
  ]);
});
