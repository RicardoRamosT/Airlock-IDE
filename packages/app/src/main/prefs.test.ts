import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SectionVisibility } from "../shared/ipc";
import { loadPrefs, savePrefs } from "./prefs";

describe("app prefs", () => {
  it("returns defaults when the file is absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    expect(await loadPrefs(path.join(dir, "prefs.json"))).toEqual({
      sidebarVisible: true,
      sidebarPosition: "left",
      theme: "dark",
      sectionVisibility: {
        files: true,
        secrets: true,
        git: true,
        activity: true,
        databases: true,
        docker: true,
        host: true,
        audit: true,
      },
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
      theme: "dark",
      sectionVisibility: {
        files: true,
        secrets: true,
        git: true,
        activity: true,
        databases: true,
        docker: true,
        host: true,
        audit: true,
      },
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
        theme: "neon",
        junk: 1,
      }),
    );
    expect(await loadPrefs(file)).toEqual({
      sidebarVisible: true,
      sidebarPosition: "left",
      theme: "dark",
      sectionVisibility: {
        files: true,
        secrets: true,
        git: true,
        activity: true,
        databases: true,
        docker: true,
        host: true,
        audit: true,
      },
    });
  });

  it("returns defaults (no throw) on malformed JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(file, "{ not json");
    expect(await loadPrefs(file)).toEqual({
      sidebarVisible: true,
      sidebarPosition: "left",
      theme: "dark",
      sectionVisibility: {
        files: true,
        secrets: true,
        git: true,
        activity: true,
        databases: true,
        docker: true,
        host: true,
        audit: true,
      },
    });
  });

  it("round-trips theme and sanitizes garbage theme to dark", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    // A valid theme value persists and reloads.
    const next = await savePrefs(file, { theme: "light" });
    expect(next.theme).toBe("light");
    expect((await loadPrefs(file)).theme).toBe("light");
    // A garbage theme value sanitizes back to the dark default.
    await writeFile(file, JSON.stringify({ theme: "solarized" }));
    expect((await loadPrefs(file)).theme).toBe("dark");
  });

  it("defaults sectionVisibility to all eight sections visible", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    expect(
      (await loadPrefs(path.join(dir, "prefs.json"))).sectionVisibility,
    ).toEqual({
      files: true,
      secrets: true,
      git: true,
      activity: true,
      databases: true,
      docker: true,
      host: true,
      audit: true,
    });
  });

  it("persists a partial sectionVisibility as a full map", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    // A deliberately partial map (e.g. a malformed patch) must expand to full.
    const next = await savePrefs(file, {
      sectionVisibility: { docker: false } as SectionVisibility,
    });
    expect(next.sectionVisibility).toEqual({
      files: true,
      secrets: true,
      git: true,
      activity: true,
      databases: true,
      docker: false,
      host: true,
      audit: true,
    });
    expect((await loadPrefs(file)).sectionVisibility).toEqual({
      files: true,
      secrets: true,
      git: true,
      activity: true,
      databases: true,
      docker: false,
      host: true,
      audit: true,
    });
  });

  it("sanitizes a non-object sectionVisibility to all-true", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(file, JSON.stringify({ sectionVisibility: 5 }));
    expect((await loadPrefs(file)).sectionVisibility).toEqual({
      files: true,
      secrets: true,
      git: true,
      activity: true,
      databases: true,
      docker: true,
      host: true,
      audit: true,
    });
  });

  it("ignores non-boolean and unknown sectionVisibility keys", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(
      file,
      JSON.stringify({ sectionVisibility: { docker: "no", bogus: 1 } }),
    );
    expect((await loadPrefs(file)).sectionVisibility).toEqual({
      files: true,
      secrets: true,
      git: true,
      activity: true,
      databases: true,
      docker: true,
      host: true,
      audit: true,
    });
  });
});
