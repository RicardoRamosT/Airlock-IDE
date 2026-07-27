// packages/app/src/main/extensions/slackFiles.ts
// Download a Slack attachment for the UI. THE GATE: a file is fetchable only
// when it is attached to a message in an ALLOW-LISTED channel -- never by bare
// id -- so attachments cannot become a way around the channel allow-list.
//
// The vaulted token is used here and never leaves: the renderer receives a
// project-relative path to a cached copy, never a URL that needs auth.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureAirlockDir,
  getSecretValue,
  type SlackHistory,
  slackChannelHistory,
} from "@airlock/agent-core";
import {
  type AllowedChannel,
  allowedChannels,
  SLACK_TOKEN_NAME,
} from "./slack";
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
  writeCache?: (root: string, name: string, bytes: Buffer) => Promise<string>;
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

// Cache under .airlock/slack/, which already carries an ignore-all .gitignore,
// so a downloaded attachment never shows up as a repo change.
async function realWriteCache(
  root: string,
  name: string,
  bytes: Buffer,
): Promise<string> {
  await ensureAirlockDir(root);
  const dir = path.join(root, ".airlock", "slack");
  await mkdir(dir, { recursive: true });
  // Flatten the name: a Slack filename is untrusted and must not escape the dir.
  const safe = name.replace(/[/\\]/g, "_");
  await writeFile(path.join(dir, safe), bytes);
  return path.posix.join(".airlock", "slack", safe);
}

export async function slackDownloadFileTool(
  root: string | null,
  channel: string,
  fileId: string,
  deps: SlackFileDeps = {},
): Promise<{ relPath?: string; error?: string }> {
  if (!root) return { error: "No project is focused." };
  const getAllowed = deps.allowed ?? allowedChannels;
  const getToken =
    deps.token ??
    ((r: string) => getSecretValue(r, SLACK_TOKEN_NAME).catch(() => null));
  const getHistory = deps.history ?? slackChannelHistory;
  const fetchBytes = deps.fetchBytes ?? realFetchBytes;
  const writeCache = deps.writeCache ?? realWriteCache;

  const allowed = await getAllowed(root);
  const match = resolveAllowedChannel(allowed, channel);
  if (!match) return { error: `Channel "${channel}" is not allowed.` };

  const token = await getToken(root);
  if (!token) return { error: "Slack is not connected for this project." };

  const history = await getHistory(token, match.id, PROOF_WINDOW);
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
  const relPath = await writeCache(root, got.name, got.bytes);
  return { relPath };
}
