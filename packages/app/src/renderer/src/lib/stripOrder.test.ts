import { expect, it } from "vitest";
import { dropPlace, reconcileOrder, stripLiveKeys } from "./stripOrder";

it("reconcileOrder returns live as-is when nothing was stored", () => {
  expect(reconcileOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
});

it("reconcileOrder honors the stored order for keys still live", () => {
  expect(reconcileOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual([
    "c",
    "a",
    "b",
  ]);
});

it("reconcileOrder drops stale keys and appends new live keys at the end", () => {
  // "x" is stale (gone); "d" is new (not yet ordered) -> appended last.
  expect(reconcileOrder(["x", "b", "a"], ["a", "b", "d"])).toEqual([
    "b",
    "a",
    "d",
  ]);
});

it("stripLiveKeys lists project tab ids then open page-tabs (one per overview root)", () => {
  expect(
    stripLiveKeys([{ id: "t1" }, { id: "t2" }], null, {
      settings: true,
      usage: false,
      overviews: ["/a", "/b"],
    }),
  ).toEqual([
    "t1",
    "t2",
    "page:settings",
    "page:overview:/a",
    "page:overview:/b",
  ]);
});

it("stripLiveKeys collapses a split pair to one 'pair' key at member a, omitting b", () => {
  expect(
    stripLiveKeys(
      [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
      { a: "t2", b: "t3" },
      { settings: false, usage: false, overviews: [] },
    ),
  ).toEqual(["t1", "pair"]);
});

it("dropPlace splits a tab at its horizontal midpoint", () => {
  const rect = { left: 100, width: 40 }; // midpoint = 120
  expect(dropPlace(rect, 110)).toBe("before");
  expect(dropPlace(rect, 130)).toBe("after");
  expect(dropPlace(rect, 120)).toBe("after"); // exactly midpoint -> after
});
