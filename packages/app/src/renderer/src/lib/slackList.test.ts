import { describe, expect, it } from "vitest";
import type { SlackAllowedChannel } from "../../../shared/ipc";
import {
  CHANNEL_CAP,
  filterChannels,
  nextMessageLimit,
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

describe("nextMessageLimit", () => {
  it("climbs 20 -> 50 -> 100 then stops", () => {
    expect(nextMessageLimit(20)).toBe(50);
    expect(nextMessageLimit(50)).toBe(100);
    // null, not 100: the UI must say "that is the maximum" rather than offer a
    // button that fetches the same thing again.
    expect(nextMessageLimit(100)).toBeNull();
  });

  it("treats an unknown limit as exhausted rather than guessing", () => {
    expect(nextMessageLimit(999)).toBeNull();
  });
});
