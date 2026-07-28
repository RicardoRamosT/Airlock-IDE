import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAirlockDir } from "./airlockDir";

export interface ProjectConfig {
  injectSecretsIntoTerminal: boolean;
  // Local dev-server URL for the Host section probe (e.g. http://localhost:3000).
  // Optional: undefined by default, so it is omitted from DEFAULTS. A partial
  // { devUrl } patch persists via writeProjectConfig and survives readProjectConfig.
  devUrl?: string;
  // Command that starts this project's local dev server (e.g. "npm run dev").
  // Optional: when set it is the human-blessed command the managed dev server
  // runs; when absent the UI may guess-and-confirm one, and the agent's
  // start_dev_server refuses (a guess alone is not enough). Persists like devUrl.
  devCommand?: string;
  // Per-project GitHub account override for git remote ops + commit identity.
  // Absent => auto-detect from the repo's origin owner. Stores only a reference
  // (host + username), never a credential.
  githubAccount?: { host: string; username: string };
  // Which Neon account (from the multi-account pool) this project uses. Absent
  // => the sole account if there's exactly one, else the user picks. Stores only
  // the account id (a reference); the API key lives in the keychain.
  neonAccountId?: string;
  // Per-project config for connected extensions (Tier-2), keyed by extension id.
  // Non-secret only -- e.g. Slack's channel allow-list (the permission wall).
  // Secrets (the Slack token) live in the vault, never here. Absent => none.
  extensions?: Record<string, Record<string, unknown>>;
}

const DEFAULTS: ProjectConfig = { injectSecretsIntoTerminal: false };

function configFile(root: string): string {
  return path.join(root, ".airlock", "config.json");
}

// Load the config AND report whether the file was unparseable. Readers only want
// the config, but the writer has to know: merging a patch onto defaults, when a
// perfectly good file was merely unreadable, is how one bad byte becomes an
// emptied Slack allow-list and a forgotten devCommand.
async function loadProjectConfig(
  root: string,
): Promise<{ cfg: ProjectConfig; corruptText?: string }> {
  // Distinguish an absent file (normal: return defaults silently) from a
  // malformed file (a user typo: still return defaults, but warn so the
  // ignored config is not silently hidden).
  let text: string;
  try {
    text = await readFile(configFile(root), "utf8");
  } catch {
    // Read failure (ENOENT or otherwise) means no usable config - defaults.
    return { cfg: { ...DEFAULTS } };
  }
  try {
    return {
      cfg: { ...DEFAULTS, ...(JSON.parse(text) as Partial<ProjectConfig>) },
    };
  } catch {
    console.warn("[airlock] .airlock/config.json malformed, using defaults");
    return { cfg: { ...DEFAULTS }, corruptText: text };
  }
}

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  return (await loadProjectConfig(root)).cfg;
}

let tmpSeq = 0;
const nextTmpId = () => `${Date.now().toString(36)}${(tmpSeq++).toString(36)}`;

// One in-flight write per root, chained. rename(2) already guarantees each FILE
// is whole, but the read-modify-write around it is not atomic: two overlapping
// calls both read the same "before" state, and the later rename discards
// whatever the earlier one added. That is a silent data loss with a very
// confusing face -- the Slack allow-list vanishing seconds after a connect
// recorded the workspace, or the workspace reading "unknown" right after
// auth.test identified it. Same class as the quota reconcile serialization in
// main/quota/wire.ts.
const writeChains = new Map<string, Promise<unknown>>();

// `patch` may be a function of the CURRENT config, evaluated once the chain
// below has the root to itself. That is the only way to do a read-modify-write
// safely: computing the patch at the call site reads a "before" state that a
// queued predecessor is about to invalidate. See patchProjectExtension.
export type ConfigPatch =
  | Partial<ProjectConfig>
  | ((cfg: ProjectConfig) => Partial<ProjectConfig>);

export function writeProjectConfig(
  root: string,
  patch: ConfigPatch,
): Promise<ProjectConfig> {
  const tail = writeChains.get(root) ?? Promise.resolve();
  // Both arms run the write: a predecessor that REJECTED must not cancel the
  // calls queued behind it, it only has to finish first.
  const run = tail.then(
    () => writeConfigNow(root, patch),
    () => writeConfigNow(root, patch),
  );
  const link = run.catch(() => {});
  writeChains.set(root, link);
  // Let the map shrink again once this call is the last one queued, so a
  // long-lived process does not retain an entry per root it ever touched.
  void link.then(() => {
    if (writeChains.get(root) === link) writeChains.delete(root);
  });
  return run;
}

async function writeConfigNow(
  root: string,
  patch: ConfigPatch,
): Promise<ProjectConfig> {
  const { cfg, corruptText } = await loadProjectConfig(root);
  if (corruptText !== undefined) {
    // The file would not parse, so `cfg` is DEFAULTS and this write is about to
    // replace the user's real settings with defaults+patch. Keep the original
    // bytes first: a recoverable .corrupt file beats a silently emptied config.
    // Best-effort -- failing to save the copy must not block the write, or the
    // app would be wedged by an unwritable directory.
    await writeFile(`${configFile(root)}.corrupt`, corruptText, {
      encoding: "utf8",
      mode: 0o600,
    }).catch(() => {});
  }
  // Evaluated HERE, not at the call site: `cfg` is the state after every
  // queued predecessor has landed, so a function patch cannot be computed from
  // a snapshot that is already stale.
  const next = {
    ...cfg,
    ...(typeof patch === "function" ? patch(cfg) : patch),
  };
  await ensureAirlockDir(root); // create .airlock + drop the ignore-all .gitignore
  // ATOMIC: write a temp file, then rename over the target. A plain writeFile
  // truncates first, so any concurrent reader -- the sidebar re-reading the
  // Slack allow-list, a tool resolving devCommand -- could parse a half-written
  // file. readProjectConfig turns a parse failure into DEFAULTS, so that window
  // presented as "every setting silently reverted": an emptied channel
  // allow-list, includePrivate flipping to false. rename(2) is atomic within a
  // filesystem, so a reader sees either the old file or the new one, never a
  // partial one.
  // mode 0o600: least-privilege, matching the secrets meta hardening.
  // Unique per CALL, not just per process: two concurrent writes sharing one
  // temp path would race, and the loser's rename would fail with ENOENT.
  const tmp = `${configFile(root)}.${process.pid}.${nextTmpId()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, configFile(root));
  return next;
}

// Merge `patch` into ONE extension's per-project sub-object, leaving every
// other extension and every top-level key untouched.
//
// The naive form -- read the config, spread `extensions` by hand, hand the
// whole map to writeProjectConfig -- is what the callers used to do, and it is
// unsafe: `extensions` is merged SHALLOWLY like any other top-level key, so the
// map you pass replaces the stored one wholesale. Get the read slightly wrong
// (or race a concurrent caller, whose write lands between your read and your
// write) and you silently drop another extension's config -- in practice
// Slack's workspace binding and channel allow-list.
//
// Passing a FUNCTION patch moves the read inside the per-root write chain, so
// it sees every predecessor's result. Concurrent patches to different
// extensions -- or to different keys of the same extension -- all survive.
//
// `patch` itself may be a function of THIS extension's current sub-object, for
// a patch whose content depends on what is already stored (Slack's connect
// capture resets `channels` only when the workspace changed). Same reason:
// that decision must be made against post-predecessor state, not a snapshot
// the caller took before queueing.
export function patchProjectExtension(
  root: string,
  id: string,
  patch:
    | Record<string, unknown>
    | ((
        current: Record<string, unknown> | undefined,
      ) => Record<string, unknown>),
): Promise<ProjectConfig> {
  return writeProjectConfig(root, (cfg) => {
    const exts = cfg.extensions ?? {};
    const next = typeof patch === "function" ? patch(exts[id]) : patch;
    return { extensions: { ...exts, [id]: { ...(exts[id] ?? {}), ...next } } };
  });
}
