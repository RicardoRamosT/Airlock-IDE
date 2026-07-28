// packages/app/src/main/extensions/slackFiles.ts
// Download a Slack attachment for the UI. THE GATE: a file is fetchable only
// when it is attached to a message in an ALLOW-LISTED channel -- never by bare
// id -- so attachments cannot become a way around the channel allow-list.
//
// The vaulted token is used here and never leaves: the renderer receives a
// project-relative path to a cached copy, never a URL that needs auth.

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { type SlackHistory, slackChannelHistory } from "@airlock/agent-core";
import { slackTokenFor } from "../slack/accounts";
import { type AllowedChannel, allowedChannels } from "./slack";
import { recentHistory } from "./slackHistoryCache";
import { resolveAllowedChannel } from "./slackTools";

// Big enough for a screenshot, small enough that a stray video cannot fill the
// disk or stall the write.
const MAX_BYTES = 25 * 1024 * 1024;
// How far back we look to prove the file belongs to the channel.
const PROOF_WINDOW = 100;

export interface SlackFileDeps {
  allowed?: (root: string) => Promise<AllowedChannel[]>;
  token?: (root: string) => Promise<string | null>;
  history?: (
    token: string,
    channel: string,
    limit: number,
  ) => Promise<SlackHistory>;
  fetchBytes?: (
    token: string,
    fileId: string,
  ) => Promise<{ bytes: Buffer; name: string } | { error: string }>;
  writeCache?: (
    root: string,
    channelId: string,
    fileId: string,
    name: string,
    bytes: Buffer,
  ) => Promise<string>;
  cached?: (
    root: string,
    channelId: string,
    fileId: string,
  ) => Promise<string | null>;
  recent?: (root: string, channelId: string) => SlackHistory | null;
}

// Fetch a file's bytes via files.info -> url_private. Requires files:read; a
// token without it gets `missing_scope`, which the caller turns into a
// reconnect instruction.
async function realFetchBytes(
  token: string,
  fileId: string,
): Promise<{ bytes: Buffer; name: string } | { error: string }> {
  const info = (await fetch("https://slack.com/api/files.info", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams({ file: fileId }).toString(),
  }).then((r) => r.json())) as Record<string, unknown>;
  if (info.ok !== true) return { error: String(info.error ?? "unknown_error") };
  const file = (info.file ?? {}) as Record<string, unknown>;
  const url = typeof file.url_private === "string" ? file.url_private : "";
  if (!url) return { error: "no_url" };
  const size = typeof file.size === "number" ? file.size : 0;
  if (size > MAX_BYTES) return { error: "too_large" };
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { error: `http_${res.status}` };
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) return { error: "too_large" };
  return { bytes, name: typeof file.name === "string" ? file.name : fileId };
}

// Where a downloaded attachment lands. Deliberately NOT .airlock/: that
// directory holds secrets.json and the audit chain, and targetsVault() blocks
// every path containing an .airlock segment at 16 IPC call sites -- so a file
// cached there can be written but never opened. That guard is the product's
// core boundary and is not to be weakened.
//
// Kept project-relative so the existing editor tab can open it by relPath, and
// hidden from git via .git/info/exclude -- a LOCAL ignore, so the user's own
// .gitignore is never modified and the cache never shows up in git status.
const CACHE_DIR = ".slack-cache";

// Add the cache dir to the repo's local exclude file, once. Best-effort: a
// non-git project simply has no .git/info to write to, which is fine.
async function ensureLocallyIgnored(root: string): Promise<void> {
  const exclude = path.join(root, ".git", "info", "exclude");
  try {
    const cur = await readFile(exclude, "utf8").catch(() => "");
    if (cur.split(/\r?\n/).includes(`${CACHE_DIR}/`)) return;
    await appendFile(
      exclude,
      `${cur.endsWith("\n") || cur === "" ? "" : "\n"}${CACHE_DIR}/\n`,
    );
  } catch {
    // Not a git repo, or no permission: the cache still works, it is just visible.
  }
}

// One directory per (channel, file), so a cached copy can be found WITHOUT
// knowing its filename, and so a file cached under one channel can never be
// served for another -- the directory itself carries the membership proof.
const fileDir = (channelId: string, fileId: string) =>
  path.posix.join(CACHE_DIR, safeSeg(channelId), safeSeg(fileId));

// Slack ids are [A-Z0-9]+, but never trust that: a segment must not escape.
const safeSeg = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

async function realCached(
  root: string,
  channelId: string,
  fileId: string,
): Promise<string | null> {
  const rel = fileDir(channelId, fileId);
  const entries = await readdir(path.join(root, rel)).catch(
    () => [] as string[],
  );
  const name = entries[0];
  return name ? path.posix.join(rel, name) : null;
}

async function realWriteCache(
  root: string,
  channelId: string,
  fileId: string,
  name: string,
  bytes: Buffer,
): Promise<string> {
  const rel = fileDir(channelId, fileId);
  await mkdir(path.join(root, rel), { recursive: true });
  await ensureLocallyIgnored(root);
  // Flatten the name: a Slack filename is untrusted and must not escape the dir.
  const safe = name.replace(/[/\\]/g, "_") || fileId;
  await writeFile(path.join(root, rel, safe), bytes);
  return path.posix.join(rel, safe);
}

export async function slackDownloadFileTool(
  root: string | null,
  channel: string,
  fileId: string,
  deps: SlackFileDeps = {},
): Promise<{ relPath?: string; error?: string }> {
  if (!root) return { error: "No project is focused." };
  const getAllowed = deps.allowed ?? allowedChannels;
  const getToken = deps.token ?? ((r: string) => slackTokenFor(r));
  const getHistory = deps.history ?? slackChannelHistory;
  const fetchBytes = deps.fetchBytes ?? realFetchBytes;
  const writeCache = deps.writeCache ?? realWriteCache;
  const cached = deps.cached ?? realCached;
  const recent = deps.recent ?? recentHistory;

  const allowed = await getAllowed(root);
  const match = resolveAllowedChannel(allowed, channel);
  if (!match) return { error: `Channel "${channel}" is not allowed.` };

  // Already downloaded? Serve it without touching the network. The allow-list
  // check above still ran, so live policy is still enforced; what is reused is
  // the MEMBERSHIP proof, and that is an immutable historical fact -- a file
  // that was in this channel's history cannot later not have been.
  const hit = await cached(root, match.id, fileId);
  if (hit) return { relPath: hit };

  const token = await getToken(root);
  if (!token) return { error: "Slack is not connected for this project." };

  // Reuse the history the sidebar just fetched when it is fresh; otherwise pay
  // for the proof.
  const history =
    recent(root, match.id) ?? (await getHistory(token, match.id, PROOF_WINDOW));
  if (!history.ok) return { error: `Slack refused: ${history.error}` };
  const present = history.messages.some((m) =>
    m.files.some((f) => f.id === fileId),
  );
  if (!present) {
    // A false negative (an older file) is the right failure: trusting a bare
    // file id is exactly the hole the allow-list exists to close.
    return {
      error: `File is not in the recent history of "${match.name}", so it cannot be fetched.`,
    };
  }

  const got = await fetchBytes(token, fileId);
  if ("error" in got) {
    if (got.error === "missing_scope") {
      return {
        error:
          "Slack needs the files:read permission. Reconnect Slack for this project to enable attachments.",
      };
    }
    if (got.error === "too_large") {
      return { error: "That file is too large to open here (over 25 MB)." };
    }
    return { error: `Slack refused: ${got.error}` };
  }
  const relPath = await writeCache(root, match.id, fileId, got.name, got.bytes);
  return { relPath };
}
