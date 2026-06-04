import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPrefs, savePrefs } from "./prefs";

describe("app prefs", () => {
  it("returns defaults when the file is absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    expect(await loadPrefs(path.join(dir, "prefs.json"))).toEqual({
      sidebarVisible: true,
      sidebarPosition: "left",
    });
  });

  it("persists and reloads a patch", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    const next = await savePrefs(file, { sidebarPosition: "right" });
    expect(next.sidebarPosition).toBe("right");
    expect(next.sidebarVisible).toBe(true);
    expect(await loadPrefs(file)).toEqual({
      sidebarVisible: true,
      sidebarPosition: "right",
    });
  });

  it("sanitizes unknown/garbage fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(
      file,
      JSON.stringify({
        sidebarPosition: "sideways",
        sidebarVisible: "yes",
        junk: 1,
      }),
    );
    expect(await loadPrefs(file)).toEqual({
      sidebarVisible: true,
      sidebarPosition: "left",
    });
  });

  it("returns defaults (no throw) on malformed JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(file, "{ not json");
    expect(await loadPrefs(file)).toEqual({
      sidebarVisible: true,
      sidebarPosition: "left",
    });
  });
});
