import type { SlackAllowedChannel } from "../../../shared/ipc";

// What the allow-list should become when the picker is saved.
//
// The picker can only show what conversations.list returned, and that list is
// narrower than the allow-list whenever `includePrivate` is off (DMs and
// private channels are omitted) or the fetch partly failed. The old save was
// `available.filter(c => selected.has(c.id))`, so any allow-listed channel the
// picker could not display was silently DELETED -- the user lost access they
// never revoked, and could not even see it happening.
//
// So an entry survives if it is still selected, whether or not the picker could
// list it. Unchecking still removes, because an unlisted channel cannot be
// unchecked -- it is simply carried over. Removing one of those is what the
// sidebar's per-row × is for.
export function mergeAllowList(
  available: SlackAllowedChannel[],
  selected: Set<string>,
  current: SlackAllowedChannel[],
): SlackAllowedChannel[] {
  const listed = new Set(available.map((c) => c.id));
  // Fresh metadata for anything the picker showed...
  const kept = available
    .filter((c) => selected.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  // ...plus the still-selected entries it could not show, unchanged.
  const carried = current
    .filter((c) => selected.has(c.id) && !listed.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  return [...kept, ...carried];
}

// How many allow-listed conversations the picker could not display. The modal
// says this out loud: a hidden entry that is silently preserved is better than
// one silently deleted, but neither should be invisible.
export function unlistedCount(
  available: SlackAllowedChannel[],
  current: SlackAllowedChannel[],
): number {
  const listed = new Set(available.map((c) => c.id));
  return current.filter((c) => !listed.has(c.id)).length;
}
