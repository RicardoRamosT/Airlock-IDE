import { expect, it } from "vitest";
import { resolveRootTabId } from "./editorFiles";

it("resolveRootTabId returns the id of the tab matching the root", () => {
  const tabs = [
    { id: "t1", root: "/a" },
    { id: "t2", root: "/b" },
    { id: "t3", root: null },
  ];
  expect(resolveRootTabId(tabs, "/b")).toBe("t2");
});

it("resolveRootTabId returns null when no open tab has that root", () => {
  expect(resolveRootTabId([{ id: "t1", root: "/a" }], "/z")).toBe(null);
});
