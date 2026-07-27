// Pure list logic for the Slack sidebar: what to show, how much, and how far
// back. Kept out of the components so the scale rules are testable without a
// DOM -- they are the part most likely to be got subtly wrong.
import type { SlackAllowedChannel } from "../../../shared/ipc";

// How many channels render before the list collapses behind "... N more".
export const CHANNEL_CAP = 15;
// How many messages a thread fetches when first expanded.
export const FIRST_MESSAGE_LIMIT = 20;

// Rows display as "# name" / "@ name", so a query copied from the screen may
// carry the glyph. Strip it rather than returning no matches.
const normalise = (s: string) => s.trim().replace(/^[#@]/, "").toLowerCase();

export function filterChannels(
  channels: SlackAllowedChannel[],
  query: string,
): SlackAllowedChannel[] {
  const q = normalise(query);
  if (!q) return channels;
  return channels.filter((c) => c.name.toLowerCase().includes(q));
}

export function visibleChannels(
  channels: SlackAllowedChannel[],
  opts: { filtering: boolean; showAll: boolean; cap: number },
): { shown: SlackAllowedChannel[]; hidden: number } {
  // A filter is an explicit request for specific rows; capping it would hide
  // the very match that was searched for.
  if (opts.filtering || opts.showAll || channels.length <= opts.cap) {
    return { shown: channels, hidden: 0 };
  }
  return {
    shown: channels.slice(0, opts.cap),
    hidden: channels.length - opts.cap,
  };
}

// The ladder stops at 100 because slackChannelHistory clamps its limit to
// [1,100] -- Slack's own per-request ceiling. Returning null lets the UI state
// that plainly instead of offering a no-op button.
const LADDER: Record<number, number | null> = { 20: 50, 50: 100, 100: null };

export function nextMessageLimit(current: number): number | null {
  return LADDER[current] ?? null;
}
