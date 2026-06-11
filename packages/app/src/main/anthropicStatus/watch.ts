// Polls the Anthropic Statuspage summary on a timer, caches the latest reading,
// and broadcasts it to every window (the quota-watcher shape). Best-effort: a
// fetch failure caches an "unknown" reading and never throws.
//
// ASCII-only comments: this module is CJS-bundled into the Electron main
// process and Electron's cjs_lexer crashes on multibyte characters.
import { fetchAnthropicStatus } from "@airlock/agent-core";
import { BrowserWindow } from "electron";
import type { AnthropicStatus } from "../../shared/ipc";

const POLL_MS = 90_000;

let timer: ReturnType<typeof setInterval> | null = null;
let latest: AnthropicStatus | null = null;

export function getAnthropicStatus(): AnthropicStatus | null {
  return latest;
}

function broadcast(s: AnthropicStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed())
      w.webContents.send("anthropicStatus:changed", s);
  }
}

async function tick(): Promise<void> {
  // Stamp updatedAt from Date.now (seconds). A network failure degrades to
  // "unknown" rather than throwing, so a flaky link never spams or crashes.
  let parsed: { indicator: AnthropicStatus["indicator"]; description: string };
  try {
    parsed = await fetchAnthropicStatus();
  } catch {
    parsed = { indicator: "unknown", description: "" };
  }
  latest = { ...parsed, updatedAt: Math.floor(Date.now() / 1000) };
  broadcast(latest);
}

export function startAnthropicStatusWatch(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), POLL_MS);
}

export function stopAnthropicStatusWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
  latest = null;
}
