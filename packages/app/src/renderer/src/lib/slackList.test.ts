import { describe, expect, it } from "vitest";
import type { SlackAllowedChannel } from "../../../shared/ipc";
import {
  CHANNEL_CAP,
  cursorAt,
  FIRST_PAGE,
  filterChannels,
  pageBack,
  pageForward,
  visibleChannels,
} from "./slackList";

const ch = (name: string): SlackAllowedChannel => ({
  id: `C-${name}`,
  name,
  kind: "public",
});
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ch(`chan-${i}`));

describe("filterChannels", () => {
  const list = [ch("general-airlock"), ch("redes sociales"), ch("Slackbot")];

  it("matches case-insensitively on a substring", () => {
    expect(filterChannels(list, "GENERAL").map((c) => c.name)).toEqual([
      "general-airlock",
    ]);
  });

  // Rows render as "# general" / "@ Slackbot", so a user typing what they see
  // must not be punished for including the glyph.
  it("ignores a leading # or @ and surrounding space in the query", () => {
    expect(filterChannels(list, "  #general ").map((c) => c.name)).toEqual([
      "general-airlock",
    ]);
    expect(filterChannels(list, "@slackbot").map((c) => c.name)).toEqual([
      "Slackbot",
    ]);
  });

  it("returns everything for an empty or whitespace query", () => {
    expect(filterChannels(list, "")).toHaveLength(3);
    expect(filterChannels(list, "   ")).toHaveLength(3);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterChannels(list, "zzz")).toEqual([]);
  });
});

describe("visibleChannels", () => {
  const opts = { filtering: false, showAll: false, cap: CHANNEL_CAP };

  it("shows everything when under the cap", () => {
    const r = visibleChannels(many(6), opts);
    expect(r.shown).toHaveLength(6);
    expect(r.hidden).toBe(0);
  });

  it("caps a long list and reports the remainder", () => {
    const r = visibleChannels(many(100), opts);
    expect(r.shown).toHaveLength(15);
    expect(r.hidden).toBe(85);
  });

  it("shows everything once showAll is set", () => {
    const r = visibleChannels(many(100), { ...opts, showAll: true });
    expect(r.shown).toHaveLength(100);
    expect(r.hidden).toBe(0);
  });

  // Capping search results would hide exactly what the user asked for.
  it("NEVER caps while filtering", () => {
    const r = visibleChannels(many(100), { ...opts, filtering: true });
    expect(r.shown).toHaveLength(100);
    expect(r.hidden).toBe(0);
  });
});

// This replaced a 20 -> 50 -> 100 "Show earlier" ladder. The ladder could not
// reach past 100 (conversations.history clamps one request to 100), so the
// oldest messages in a busy channel were simply unreachable; cursor paging has
// no such ceiling.
describe("page cursors", () => {
  it("starts on the newest page, which needs no cursor", () => {
    expect(FIRST_PAGE.index).toBe(0);
    expect(cursorAt(FIRST_PAGE)).toBeUndefined();
  });

  it("walks forward through history and back again", () => {
    const p1 = pageForward(FIRST_PAGE, "cur1");
    expect(p1.index).toBe(1);
    expect(cursorAt(p1)).toBe("cur1");

    const p2 = pageForward(p1, "cur2");
    expect(p2.index).toBe(2);
    expect(cursorAt(p2)).toBe("cur2");

    // Going back re-uses the cursor that fetched that page, so "Newer" lands on
    // the same messages rather than re-deriving them.
    const back = pageBack(p2);
    expect(back.index).toBe(1);
    expect(cursorAt(back)).toBe("cur1");
    expect(cursorAt(pageBack(back))).toBeUndefined();
  });

  it("cannot step back past the newest page", () => {
    expect(pageBack(FIRST_PAGE)).toEqual(FIRST_PAGE);
  });

  it("drops stale cursors ahead of the current page", () => {
    // Walk out to page 2, come back to page 1, then go forward with a DIFFERENT
    // cursor (a refresh handed back new ones). The old page-2 cursor must not
    // survive behind the new one.
    const p2 = pageForward(pageForward(FIRST_PAGE, "cur1"), "cur2");
    const reforked = pageForward(pageBack(p2), "cur2-fresh");
    expect(reforked.index).toBe(2);
    expect(reforked.stack).toEqual([undefined, "cur1", "cur2-fresh"]);
  });

  it("does not mutate the page it was given", () => {
    const before = { ...FIRST_PAGE, stack: [...FIRST_PAGE.stack] };
    pageForward(FIRST_PAGE, "cur1");
    expect(FIRST_PAGE).toEqual(before);
  });
});
