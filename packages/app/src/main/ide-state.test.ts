import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listSidebarSections } from "./ide-state";

// listSidebarSections is the one NEW (MCP-only) read with no existing coverage.
// The other ide-state functions are thin extractions of already-tested IPC
// bodies and rely on that coverage plus the typecheck gate. Here we pin the
// projection shape: the canonical 9-section order (Activity added after Git),
// human labels, and the default-true visibility semantics (absent /
// non-false -> visible).
describe("listSidebarSections", () => {
  it("returns all nine built-in sections in order, all visible by default", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-ide-state-"));
    const rows = await listSidebarSections(path.join(dir, "prefs.json"));
    expect(rows).toEqual([
      { id: "files", label: "Files", visible: true },
      { id: "secrets", label: "Secrets", visible: true },
      { id: "git", label: "Git", visible: true },
      { id: "activity", label: "Activity", visible: true },
      { id: "databases", label: "Databases", visible: true },
      { id: "host", label: "Host", visible: true },
      { id: "audit", label: "Audit", visible: true },
      { id: "events", label: "Events", visible: true },
      { id: "extensions", label: "Extensions", visible: true },
    ]);
  });

  it("reflects a persisted visibility map (false hides, absent stays visible)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-ide-state-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(
      file,
      JSON.stringify({ sectionVisibility: { host: false, git: false } }),
    );
    const rows = await listSidebarSections(file);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.visible]));
    expect(byId.host).toBe(false);
    expect(byId.git).toBe(false);
    expect(byId.files).toBe(true);
    expect(byId.audit).toBe(true);
  });

  it("lists ext:* sections after the built-ins", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-ide-state-ext-"));
    const rows = await listSidebarSections(path.join(dir, "prefs.json"), [
      { id: "slack", name: "Slack" },
    ]);
    const ids = rows.map((r) => r.id);
    expect(ids[0]).toBe("files");
    expect(ids[ids.length - 1]).toBe("ext:slack");
    expect(rows[rows.length - 1]?.label).toBe("Slack");
    expect(rows[rows.length - 1]?.visible).toBe(true);
  });
});
