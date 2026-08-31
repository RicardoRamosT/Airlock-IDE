// ASCII comments only. The middle of the activity path: from the conversation's
// onActivity callback to the windows that render it.
//
// This existed at BOTH ends and nowhere in between. The conversation declared
// an onActivity dep and drove it from the CLI's streamed events, the preload
// subscribed to "atlas:activity" and the panel listened -- but nothing ever
// passed the callback and nothing ever sent the channel, so a run making a
// dozen tool calls still rendered "Still thinking... 3m 25s". Both halves
// typechecked and both were dead.
//
// EVERY WINDOW, NOT appWindows(). The Atlas popover and the standalone Atlas
// window are not app windows, so a broadcast over appWindows() can never reach
// the surfaces this is for -- the same trap as the agent-request cards, and the
// reason the atlas:refresh broadcast in ipc.ts already spells this out.

import type { AtlasActivity } from "@airlock/agent-core";

// The channel the preload subscribes to. Named here so the sender and the
// subscriber cannot drift apart silently, which is how the last one died.
export const ATLAS_ACTIVITY_CHANNEL = "atlas:activity";

// Structurally what a BrowserWindow gives us, so this module is testable
// without Electron (whose members are undefined under vitest by design).
export interface ActivityWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
  };
}

// Build the reporter the conversation calls as the CLI works.
//
// The window list is read PER BATCH, not captured: a run can outlive the window
// that started it and can also predate one that opens mid-turn. A destroyed
// window is skipped rather than sent to -- this runs inside the CLI's line
// handler, so a throw here would fail a turn that was working.
export function activityReporter(
  windows: () => Iterable<ActivityWindow>,
): (items: readonly AtlasActivity[]) => void {
  return (items) => {
    // An empty batch is not news. The renderer appends what it is given, so
    // sending one would be a render for nothing.
    if (items.length === 0) return;
    for (const w of windows()) {
      if (w.isDestroyed() || w.webContents.isDestroyed()) continue;
      w.webContents.send(ATLAS_ACTIVITY_CHANNEL, items);
    }
  };
}
