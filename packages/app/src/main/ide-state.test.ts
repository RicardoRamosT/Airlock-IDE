import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearSessionSecrets,
  type KeychainStore,
  putSessionSecret,
  setSecret,
} from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import { listSecretNames, listSidebarSections } from "./ide-state";

// listSidebarSections is the one NEW (MCP-only) read with no existing coverage.
// The other ide-state functions are thin extractions of already-tested IPC
// bodies and rely on that coverage plus the typecheck gate. Here we pin the
// projection shape: the canonical 9-section order (Activity added after Git),
// human labels, and the default-true visibility semantics (absent /
// non-false -> visible).
describe("listSidebarSections", () => {
  it("returns all eight built-in sections in order, all visible by default", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-ide-state-"));
    const rows = await listSidebarSections(path.join(dir, "prefs.json"));
    expect(rows).toEqual([
      { id: "files", label: "Files", visible: true },
      { id: "secrets", label: "Secrets", visible: true },
      { id: "git", label: "Git", visible: true },
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

describe("listSecretNames", () => {
  it("includes session-captured names, flagged, alongside a vaulted one flagged the other way", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "airlock-ide-state-secrets-"),
    );
    clearSessionSecrets();

    // A real vaulted secret via the broker's own setSecret, backed by an
    // in-memory fake keychain (same shape as broker.test.ts / run.test.ts /
    // capture.test.ts in agent-core) -- never touches the real OS keychain.
    const kcStore = new Map<string, string>();
    const fake: KeychainStore = {
      set: (s, a, v) => void kcStore.set(`${s}|${a}`, v),
      get: (s, a) => kcStore.get(`${s}|${a}`) ?? null,
      delete: (s, a) => kcStore.delete(`${s}|${a}`),
    };
    await setSecret(root, "DATABASE_URL", "postgres://dev", {
      keychain: fake,
    });
    putSessionSecret(root, "PROD_URL", "postgres://x", "az show");

    const names = await listSecretNames(root);

    const vaulted = names.find((n) => n.name === "DATABASE_URL");
    const session = names.find((n) => n.name === "PROD_URL");
    expect(vaulted).toEqual({
      name: "DATABASE_URL",
      provider: null,
      valid: true,
      session: false,
    });
    expect(session).toEqual({
      name: "PROD_URL",
      provider: null,
      valid: true,
      session: true,
    });
    // Vaulted first, session-captured last -- the ordering the agent relies
    // on to read the durable/vaulted set before the ephemeral one.
    expect(names.findIndex((n) => n.name === "DATABASE_URL")).toBeLessThan(
      names.findIndex((n) => n.name === "PROD_URL"),
    );
    const serialised = JSON.stringify(names);
    expect(serialised).not.toContain("postgres://dev");
    expect(serialised).not.toContain("postgres://x");
  });
});
