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
  // Mocked too, not just writeProjectConfig: the REAL patchProjectExtension
  // calls the real writeProjectConfig internally (a module-local call, which no
  // export mock can intercept), so it would touch the filesystem with these
  // fake roots. Mirrors the real merge -- one extension's sub-object, other
  // extensions untouched -- so these tests still exercise accounts.ts's
  // behaviour. config.test.ts owns the merge/serialisation guarantees.
  patchProjectExtension: async (
    root: string,
    id: string,
    patch:
      | Record<string, unknown>
      | ((cur: Record<string, unknown> | undefined) => Record<string, unknown>),
  ) => {
    const cfg = (configs.get(root) ?? {}) as Record<string, unknown>;
    const exts = { ...((cfg.extensions as Record<string, unknown>) ?? {}) };
    const cur = exts[id] as Record<string, unknown> | undefined;
    const next = typeof patch === "function" ? patch(cur) : patch;
    exts[id] = { ...(cur ?? {}), ...next };
    configs.set(root, { ...cfg, extensions: exts });
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

// Every project connected before the pool existed has a token vaulted under
// the per-root name. This change must not disconnect any of them.
it("folds a legacy per-project token into the pool, keeping the project connected", async () => {
  secrets.set("/a:SLACK_OAUTH_TOKEN", "xoxb-legacy");
  configs.set("/a", {
    extensions: {
      slack: { workspace: { id: "T1", name: "Airlock", domain: "airlock" } },
    },
  });

  expect(await slackTokenFor("/a")).toBe("xoxb-legacy");
  // ...and it is now pooled, so a SECOND project can reuse it.
  expect((await listSlackWorkspaces()).map((w) => w.id)).toEqual(["T1"]);
});

it("does not delete the legacy secret until the pooled copy reads back", async () => {
  // A crash between "delete old" and "write new" would lose the token and
  // force a re-authorization, so the order is load-bearing.
  secrets.set("/a:SLACK_OAUTH_TOKEN", "xoxb-legacy");
  configs.set("/a", {
    extensions: { slack: { workspace: { id: "T1", name: "A", domain: "a" } } },
  });
  await slackTokenFor("/a");
  expect(secrets.get("slack-workspace:T1")).toBe("xoxb-legacy");
  expect(secrets.has("/a:SLACK_OAUTH_TOKEN")).toBe(false);
});

it("is idempotent -- folding twice does not duplicate or break", async () => {
  secrets.set("/a:SLACK_OAUTH_TOKEN", "xoxb-legacy");
  configs.set("/a", {
    extensions: { slack: { workspace: { id: "T1", name: "A", domain: "a" } } },
  });
  await slackTokenFor("/a");
  expect(await slackTokenFor("/a")).toBe("xoxb-legacy");
  expect(await listSlackWorkspaces()).toHaveLength(1);
});

it("leaves a project with NO legacy token and no binding disconnected", async () => {
  expect(await slackTokenFor("/fresh")).toBeNull();
  expect(await listSlackWorkspaces()).toEqual([]);
});

it("does not fold when the config has no verified workspace id", async () => {
  // A pre-verification config cannot name its team id. Main resolves that with
  // one auth.test call at the CALLER (see slack.ts); this layer must not
  // invent an id.
  secrets.set("/a:SLACK_OAUTH_TOKEN", "xoxb-legacy");
  configs.set("/a", { extensions: { slack: { workspacePin: "airlock" } } });
  expect(await slackTokenFor("/a")).toBeNull();
  expect(await listSlackWorkspaces()).toEqual([]);
  // The legacy token is UNTOUCHED, so nothing is lost.
  expect(secrets.get("/a:SLACK_OAUTH_TOKEN")).toBe("xoxb-legacy");
});
