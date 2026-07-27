import { describe, expect, it } from "vitest";
import type { SlackAllowedChannel } from "../../../shared/ipc";
import { mergeAllowList, unlistedCount } from "./slackAllowList";

const c = (id: string, kind = "public"): SlackAllowedChannel => ({
  id,
  name: `n-${id}`,
  kind,
});

// The observed data loss: six allow-listed conversations (three public, three
// DMs), a picker that could only list the three public ones because
// includePrivate was off, and a save that deleted the DMs the user had never
// unchecked.
describe("mergeAllowList", () => {
  const current = [c("C1"), c("C2"), c("C3"), c("D1", "im"), c("D2", "im")];
  const availablePublicOnly = [c("C1"), c("C2"), c("C3")];
  const allSelected = new Set(["C1", "C2", "C3", "D1", "D2"]);

  it("KEEPS allow-listed conversations the picker could not list", () => {
    const next = mergeAllowList(availablePublicOnly, allSelected, current).map(
      (x) => x.id,
    );
    expect(next).toHaveLength(5);
    expect(next).toContain("D1");
    expect(next).toContain("D2");
  });

  it("still removes what the user actually unchecked", () => {
    const next = mergeAllowList(
      availablePublicOnly,
      new Set(["C1", "D1", "D2"]),
      current,
    ).map((x) => x.id);
    expect(next).toEqual(["C1", "D1", "D2"]);
  });

  it("adds a newly checked conversation", () => {
    const next = mergeAllowList(
      [...availablePublicOnly, c("C9")],
      new Set(["C1", "C9"]),
      current,
    ).map((x) => x.id);
    expect(next).toEqual(["C1", "C9"]);
  });

  it("refreshes metadata for anything the picker did list", () => {
    const renamed = [{ id: "C1", name: "renamed", kind: "private" }];
    expect(mergeAllowList(renamed, new Set(["C1"]), [c("C1")])).toEqual([
      { id: "C1", name: "renamed", kind: "private" },
    ]);
  });

  // A carried entry must not be duplicated by also appearing in `available`.
  it("never duplicates an entry present in both", () => {
    const next = mergeAllowList([c("C1")], new Set(["C1"]), [c("C1")]);
    expect(next).toHaveLength(1);
  });
});

describe("unlistedCount", () => {
  it("counts allow-listed conversations the picker cannot show", () => {
    expect(unlistedCount([c("C1")], [c("C1"), c("D1", "im")])).toBe(1);
    expect(unlistedCount([c("C1")], [c("C1")])).toBe(0);
  });
});
