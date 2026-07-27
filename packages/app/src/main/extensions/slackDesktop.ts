// packages/app/src/main/extensions/slackDesktop.ts
// Thin, untested I/O half of the workspace picker: read the Slack desktop app's
// state file so the connect modal can offer workspaces BY NAME instead of asking
// for a T0… id nobody knows. All parsing (and all field filtering -- that file
// holds session tokens) lives in agent-core's parseSlackWorkspaces.
//
// Every failure mode -- Slack not installed, sandboxed path, unreadable file,
// bad JSON -- degrades to []. An empty list is not an error: it just leaves the
// paste-a-URL fallback as the only way to choose, which is exactly right for a
// browser-only workspace the desktop app has never seen.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSlackWorkspaces, type SlackWorkspace } from "@airlock/agent-core";

export function slackRootStatePath(home: string = os.homedir()): string {
  return path.join(
    home,
    "Library",
    "Application Support",
    "Slack",
    "storage",
    "root-state.json",
  );
}

export async function localSlackWorkspaces(): Promise<SlackWorkspace[]> {
  try {
    const raw = await fs.readFile(slackRootStatePath(), "utf8");
    return parseSlackWorkspaces(JSON.parse(raw));
  } catch {
    return [];
  }
}
