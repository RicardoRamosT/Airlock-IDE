import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// In-memory stand-ins for the keychain and the per-project config. The real
// ones prompt the OS keychain and write into a project's .airlock dir.
const secrets = new Map<string, string>();
const configs = new Map<string, Record<string, unknown>>();

vi.mock("@airlock/agent-core", async (orig) => ({
  ...(await orig<typeof import("@airlock/agent-core")>()),
  setGlobalSecret: async (k: string, v: string) => {
    secrets.set(k, v);
  },
  getGlobalSecret: async (k: string) => secrets.get(k) ?? null,
  deleteGlobalSecret: async (k: string) => {
    secrets.delete(k);
  },
  readProjectConfig: async (root: string) => configs.get(root) ?? {},
  writeProjectConfig: async (root: string, patch: Record<string, unknown>) => {
    configs.set(root, { ...(configs.get(root) ?? {}), ...patch });
    return configs.get(root);
  },
  getSecretValue: async (root: string, name: string) =>
    secrets.get(`${root}:${name}`) ?? null,
  setSecret: async (root: string, name: string, v: string) => {
    secrets.set(`${root}:${name}`, v);
  },
  deleteSecret: async (root: string, name: string) => {
    secrets.delete(`${root}:${name}`);
  },
}));

// Electron's app.getPath is unavailable in a unit test; the module falls back
// to the injected test paths, but it still imports `electron`.
vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

const {
  __setSlackPathsForTest,
  addSlackWorkspace,
  bindSlackWorkspace,
  listSlackWorkspaces,
  removeSlackWorkspace,
  slackTokenFor,
} = await import("./accounts");

let dir: string;
beforeEach(async () => {
  secrets.clear();
  configs.clear();
  dir = await mkdtemp(path.join(tmpdir(), "airlock-slack-"));
  __setSlackPathsForTest({
    registry: path.join(dir, "slack-workspaces.json"),
    audit: path.join(dir, "audit.jsonl"),
  });
});
afterEach(async () => {
  __setSlackPathsForTest(null);
  await rm(dir, { recursive: true, force: true });
});

const REF = { id: "T1", name: "Airlock", domain: "airlock" };

it("pools a workspace and hands its token back", async () => {
  await addSlackWorkspace(REF, "xoxb-1");
  expect((await listSlackWorkspaces()).map((w) => w.id)).toEqual(["T1"]);
  await bindSlackWorkspace("/a", "T1");
  expect(await slackTokenFor("/a")).toBe("xoxb-1");
});

it("keeps the TOKEN out of the enumerable registry file", async () => {
  // The pool is read to render a list; it must be readable without touching
  // the keychain, and must never carry the credential itself.
  await addSlackWorkspace(REF, "xoxb-SUPERSECRET");
  const raw = await readFile(path.join(dir, "slack-workspaces.json"), "utf8");
  expect(raw).not.toContain("SUPERSECRET");
  expect(raw).toContain("T1");
});

it("does NOT connect a project that has not bound anything", async () => {
  // Even with exactly one pooled workspace. This is the isolation rule.
  await addSlackWorkspace(REF, "xoxb-1");
  expect(await slackTokenFor("/unbound")).toBeNull();
});

it("binds two projects to the same workspace independently", async () => {
  await addSlackWorkspace(REF, "xoxb-1");
  await bindSlackWorkspace("/a", "T1");
  await bindSlackWorkspace("/b", "T1");
  expect(await slackTokenFor("/a")).toBe("xoxb-1");
  expect(await slackTokenFor("/b")).toBe("xoxb-1");

  // Unbinding one leaves the other connected -- the whole point.
  await bindSlackWorkspace("/a", null);
  expect(await slackTokenFor("/a")).toBeNull();
  expect(await slackTokenFor("/b")).toBe("xoxb-1");
});

it("removing a workspace disconnects EVERY project bound to it", async () => {
  await addSlackWorkspace(REF, "xoxb-1");
  await bindSlackWorkspace("/a", "T1");
  await removeSlackWorkspace("T1");
  expect(await listSlackWorkspaces()).toEqual([]);
  // The binding is now dangling; it must read as disconnected, not throw.
  expect(await slackTokenFor("/a")).toBeNull();
});

it("re-adding a workspace refreshes its label and token without duplicating", async () => {
  await addSlackWorkspace(REF, "xoxb-1");
  await addSlackWorkspace({ ...REF, name: "Airlock HQ" }, "xoxb-2");
  const pool = await listSlackWorkspaces();
  expect(pool).toHaveLength(1);
  expect(pool[0]?.name).toBe("Airlock HQ");
  await bindSlackWorkspace("/a", "T1");
  expect(await slackTokenFor("/a")).toBe("xoxb-2");
});

it("survives a missing or malformed registry file", async () => {
  expect(await listSlackWorkspaces()).toEqual([]);
  await writeFile(path.join(dir, "slack-workspaces.json"), "{not json");
  expect(await listSlackWorkspaces()).toEqual([]);
});
