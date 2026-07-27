// Pure list logic for the Slack sidebar: what to show, how much, and how far
// back. Kept out of the components so the scale rules are testable without a
// DOM -- they are the part most likely to be got subtly wrong.
import type { SlackAllowedChannel } from "../../../shared/ipc";

// How many channels render before the list collapses behind "... N more".
export const CHANNEL_CAP = 15;
// How many messages one page of a thread shows.
export const PAGE_SIZE = 10;

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

// Where a channel is in its history, as a stack of Slack page cursors.
//
// This replaced a "Show earlier" ladder that re-fetched a BIGGER single window
// (20 -> 50 -> 100). That capped at 100 because conversations.history clamps a
// single request to 100, so the oldest messages in a busy channel were simply
// unreachable. Paging by cursor has no ceiling: each step asks Slack for the
// next page behind the current one, so the whole conversation is walkable.
//
// stack[i] is the cursor that fetches page i. Page 0 is the newest and needs no
// cursor, so stack[0] is always undefined.
export interface PageCursors {
  stack: (string | undefined)[];
  index: number;
}

export const FIRST_PAGE: PageCursors = { stack: [undefined], index: 0 };

export function cursorAt(p: PageCursors): string | undefined {
  return p.stack[p.index];
}

// Step to older messages. The stack is TRUNCATED at the current page first: a
// refresh can hand back different cursors, and keeping stale ones behind the
// current position would make "Newer" walk into pages that no longer line up.
export function pageForward(p: PageCursors, next: string): PageCursors {
  const stack = [...p.stack.slice(0, p.index + 1), next];
  return { stack, index: p.index + 1 };
}

// Step back toward the newest page. A no-op at page 0 so the caller can bind it
// to a button without guarding.
export function pageBack(p: PageCursors): PageCursors {
  return p.index <= 0 ? p : { stack: p.stack, index: p.index - 1 };
}
