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
      clipboardClearSeconds: 30,
      openProjectsAsTabs: true,
      showRunningProcessNotice: true,
      recentFolders: [],
      agentPolicy: {
        network: "allow",
        outsideWorkspace: "ask",
        destructive: "ask",
        privilege: "block",
      },
      quotaMeter: { enabled: true },
    });
  });

  // PB-H13: concurrent saves of distinct fields must ALL survive. Unserialized,
  // they read the same baseline and the last rename wins, dropping the rest.
  it("serializes concurrent saves so no patch is lost (PB-H13)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await Promise.all([
      savePrefs(file, { theme: "light" }),
      savePrefs(file, { sidebarPosition: "right" }),
      savePrefs(file, { clipboardClearSeconds: 5 }),
      savePrefs(file, { openProjectsAsTabs: false }),
      savePrefs(file, { showRunningProcessNotice: false }),
    ]);
    const prefs = await loadPrefs(file);
    expect(prefs.theme).toBe("light");
    expect(prefs.sidebarPosition).toBe("right");
    expect(prefs.clipboardClearSeconds).toBe(5);
    expect(prefs.openProjectsAsTabs).toBe(false);
    expect(prefs.showRunningProcessNotice).toBe(false);
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
      clipboardClearSeconds: 30,
      openProjectsAsTabs: true,
      showRunningProcessNotice: true,
      recentFolders: [],
      agentPolicy: {
        network: "allow",
        outsideWorkspace: "ask",
        destructive: "ask",
        privilege: "block",
      },
      quotaMeter: { enabled: true },
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
      clipboardClearSeconds: 30,
      openProjectsAsTabs: true,
      showRunningProcessNotice: true,
      recentFolders: [],
      agentPolicy: {
        network: "allow",
        outsideWorkspace: "ask",
        destructive: "ask",
        privilege: "block",
      },
      quotaMeter: { enabled: true },
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
      clipboardClearSeconds: 30,
      openProjectsAsTabs: true,
      showRunningProcessNotice: true,
      recentFolders: [],
      agentPolicy: {
        network: "allow",
        outsideWorkspace: "ask",
        destructive: "ask",
        privilege: "block",
      },
      quotaMeter: { enabled: true },
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

// sanitize() is not exported, so these go through loadPrefs against a fixture
// file -- the same accessor the rest of this suite uses -- and assert the same
// numbers the spec's direct-sanitize tests would (defaults / clamp / floor).
describe("clipboardClearSeconds", () => {
  it("defaults to 30 when absent or wrong type", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const absent = path.join(dir, "absent.json");
    expect((await loadPrefs(absent)).clipboardClearSeconds).toBe(30);
    const wrong = path.join(dir, "wrong.json");
    await writeFile(wrong, JSON.stringify({ clipboardClearSeconds: "x" }));
    expect((await loadPrefs(wrong)).clipboardClearSeconds).toBe(30);
  });
  it("clamps to [0, 3600] and floors", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const low = path.join(dir, "low.json");
    await writeFile(low, JSON.stringify({ clipboardClearSeconds: -5 }));
    expect((await loadPrefs(low)).clipboardClearSeconds).toBe(0);
    const high = path.join(dir, "high.json");
    await writeFile(high, JSON.stringify({ clipboardClearSeconds: 99999 }));
    expect((await loadPrefs(high)).clipboardClearSeconds).toBe(3600);
    const frac = path.join(dir, "frac.json");
    await writeFile(frac, JSON.stringify({ clipboardClearSeconds: 45.7 }));
    expect((await loadPrefs(frac)).clipboardClearSeconds).toBe(45);
  });
});

// sanitize() is not exported, so these go through loadPrefs against fixture
// files (the same accessor the rest of the suite uses) and cover the recents
// contract: default [], non-string/empty dropped, dedupe-keeps-first, cap at 10.
describe("recentFolders", () => {
  it("defaults to [] when absent or a non-array", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const absent = path.join(dir, "absent.json");
    expect((await loadPrefs(absent)).recentFolders).toEqual([]);
    const wrong = path.join(dir, "wrong.json");
    await writeFile(wrong, JSON.stringify({ recentFolders: "x" }));
    expect((await loadPrefs(wrong)).recentFolders).toEqual([]);
  });
  it("drops non-string and empty entries", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "mixed.json");
    await writeFile(
      file,
      JSON.stringify({ recentFolders: ["/a", 5, "", "/b"] }),
    );
    expect((await loadPrefs(file)).recentFolders).toEqual(["/a", "/b"]);
  });
  it("dedupes (keeps first) and caps at 10", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const dupes = path.join(dir, "dupes.json");
    await writeFile(
      dupes,
      JSON.stringify({ recentFolders: ["/a", "/a", "/b"] }),
    );
    expect((await loadPrefs(dupes)).recentFolders).toEqual(["/a", "/b"]);
    const manyFile = path.join(dir, "many.json");
    const many = Array.from({ length: 15 }, (_, i) => `/p${i}`);
    await writeFile(manyFile, JSON.stringify({ recentFolders: many }));
    expect((await loadPrefs(manyFile)).recentFolders).toHaveLength(10);
  });
});

describe("quotaMeter", () => {
  it("defaults quotaMeter to enabled, honors explicit false, sanitizes bad input", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "prefs-quota-"));
    const f = path.join(dir, "prefs.json");
    expect((await loadPrefs(f)).quotaMeter).toEqual({ enabled: true }); // default on
    await savePrefs(f, { quotaMeter: { enabled: false } });
    expect((await loadPrefs(f)).quotaMeter).toEqual({ enabled: false }); // explicit off honored
    // Non-boolean enabled -> falls back to the default (enabled).
    await savePrefs(f, {
      quotaMeter: { enabled: "yes" } as unknown as { enabled: boolean },
    });
    expect((await loadPrefs(f)).quotaMeter).toEqual({ enabled: true });
  });
});
