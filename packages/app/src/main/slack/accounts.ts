// The Slack workspace pool (MAIN-ONLY), mirroring main/neon/accounts.ts.
//
// Each workspace = a token in the keychain (keyed by team id) + a non-secret
// {id,name,domain} ref in a userData registry file, so the pool is enumerable
// for the UI without reading a single credential. Projects bind to a team id
// in ProjectConfig.extensions.slack.workspace.id -- a field that ALREADY
// exists, written from auth.test after a successful connect.
//
// SECURITY: tokens never leave main. Every exported function here returns refs
// or ids, except slackTokenFor, which main-side callers use to make Slack API
// calls and which must never be exposed over IPC.
//
// ASCII-only comments: this module is CJS-bundled into the Electron main
// process and Electron's cjs_lexer crashes on multibyte characters.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteGlobalSecret,
  deleteSecret,
  getGlobalSecret,
  getSecretValue,
  patchProjectExtension,
  readProjectConfig,
  resolveSlackWorkspaceId,
  type SlackWorkspaceRef,
  setGlobalSecret,
  sortWorkspaces,
  upsertWorkspace,
} from "@airlock/agent-core";
import { app } from "electron";
import { slackBindPatch } from "../extensions/slackWorkspace";

// Test seam: point the registry and audit log at a temp dir, so the unit test
// runs without Electron's userData path.
let paths: { registry: string; audit: string } | null = null;
export function __setSlackPathsForTest(
  o: { registry: string; audit: string } | null,
): void {
  paths = o;
}
const registryFile = () =>
  paths?.registry ??
  path.join(app.getPath("userData"), "slack-workspaces.json");
const auditLog = () =>
  paths?.audit ?? path.join(app.getPath("userData"), "audit-global.jsonl");

// Keychain global-secret name holding one workspace's token.
const keyName = (id: string) => `slack-workspace:${id}`;

async function readRegistry(): Promise<SlackWorkspaceRef[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(registryFile(), "utf8"));
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (w): w is SlackWorkspaceRef =>
          !!w &&
          typeof (w as SlackWorkspaceRef).id === "string" &&
          typeof (w as SlackWorkspaceRef).name === "string",
      );
    }
  } catch {
    // missing / malformed -> an empty pool, never a crash
  }
  return [];
}

async function writeRegistry(refs: SlackWorkspaceRef[]): Promise<void> {
  await writeFile(registryFile(), `${JSON.stringify(refs, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function listSlackWorkspaces(): Promise<SlackWorkspaceRef[]> {
  return sortWorkspaces(await readRegistry());
}

// Pool a workspace and its token. Re-adding an existing team id refreshes both.
export async function addSlackWorkspace(
  ref: SlackWorkspaceRef,
  token: string,
): Promise<void> {
  await setGlobalSecret(keyName(ref.id), token, { auditLog: auditLog() });
  await writeRegistry(upsertWorkspace(await readRegistry(), ref));
}

// Remove a workspace entirely. This disconnects EVERY project bound to it --
// callers must say so before asking. Bindings are left in place and resolve to
// null, so a dangling one reads as disconnected rather than as an error.
export async function removeSlackWorkspace(id: string): Promise<void> {
  await deleteGlobalSecret(keyName(id), { auditLog: auditLog() });
  await writeRegistry((await readRegistry()).filter((w) => w.id !== id));
}

// Bind a project to a workspace, or clear its binding with null. Writes the
// SAME field the connect flow already writes, so the two paths cannot diverge.
export async function bindSlackWorkspace(
  root: string,
  id: string | null,
): Promise<void> {
  const ref =
    id === null ? null : (await readRegistry()).find((w) => w.id === id);
  // Two changes from the hand-rolled version this replaces, both bugs:
  //
  // 1. slackBindPatch applies the workspace-change ALLOW-LIST RESET that the
  //    connect path has always had. Writing only `workspace` and spreading the
  //    rest through left a previous workspace's channel ids in place, and the
  //    Slack section listed them as this workspace's.
  // 2. patchProjectExtension does the read-modify-write INSIDE the per-root
  //    write chain. The old form read the whole extensions map, spread it by
  //    hand and wrote it back, so a concurrent write to another extension was
  //    silently discarded.
  await patchProjectExtension(root, "slack", (cur) =>
    slackBindPatch(cur, ref ?? (id === null ? null : { id })),
  );
}

export async function boundSlackWorkspaceId(
  root: string | null,
): Promise<string | null> {
  if (!root) return null;
  const cfg = await readProjectConfig(root).catch(() => null);
  const w = (
    cfg?.extensions?.slack as { workspace?: { id?: unknown } } | undefined
  )?.workspace;
  const bound = typeof w?.id === "string" && w.id ? w.id : null;
  return resolveSlackWorkspaceId(bound, await readRegistry());
}

// The per-root secret name Slack used before the pool existed.
const LEGACY_TOKEN_NAME = "SLACK_OAUTH_TOKEN";

// Fold a pre-pool project into the pool, ONCE, on first read.
//
// Lazy rather than a startup sweep: a sweep would have to enumerate every
// project AirLock has ever opened and read a keychain entry for each, which is
// exactly the prompt-storm this codebase already fought (see the
// secret-vault-one-item note).
//
// ORDER IS LOAD-BEARING: write the pooled copy, read it back, and only then
// delete the legacy entry. A crash in between must leave the old token intact,
// because losing it means a browser re-authorization.
async function foldLegacy(root: string): Promise<string | null> {
  const legacy = await getSecretValue(root, LEGACY_TOKEN_NAME).catch(
    () => null,
  );
  if (!legacy) return null;

  const cfg = await readProjectConfig(root).catch(() => null);
  const w = (
    cfg?.extensions?.slack as
      | { workspace?: Record<string, unknown> }
      | undefined
  )?.workspace;
  const id = typeof w?.id === "string" && w.id ? w.id : null;
  // No verified team id -> we cannot key the pool. Leave everything alone; the
  // caller resolves the id with auth.test and connects again.
  if (!id) return null;

  await addSlackWorkspace(
    {
      id,
      name: typeof w?.name === "string" && w.name ? w.name : id,
      domain: typeof w?.domain === "string" ? w.domain : "",
    },
    legacy,
  );
  if ((await getGlobalSecret(keyName(id))) !== legacy) return legacy; // keep both
  await deleteSecret(root, LEGACY_TOKEN_NAME).catch(() => {});
  return legacy;
}

// The token a project's Slack calls should use, or null when it is not bound
// to a pooled workspace. MAIN-ONLY -- never return this over IPC.
export async function slackTokenFor(
  root: string | null,
): Promise<string | null> {
  const id = await boundSlackWorkspaceId(root);
  if (id) return getGlobalSecret(keyName(id));
  return root ? foldLegacy(root) : null;
}
