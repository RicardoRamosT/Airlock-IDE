import { afterEach, beforeEach, expect, it } from "vitest";
import type { SectionVisibility } from "../../shared/ipc";
import { SECTION_META, effectiveView } from "./lib/sections";
import { useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => useApp.setState(initialState, true));
afterEach(() => useApp.setState(initialState, true));

const allVisible = Object.fromEntries(
  SECTION_META.map((m) => [m.id, true]),
) as SectionVisibility;

it("lists all eight sections in canonical sidebar order", () => {
  expect(SECTION_META.map((m) => m.id)).toEqual([
    "files",
    "secrets",
    "git",
    "activity",
    "databases",
    "docker",
    "host",
    "audit",
  ]);
});

it("defaults the active view to files", () => {
  expect(useApp.getState().activeView).toBe("files");
});

it("setActiveView switches the view", () => {
  useApp.getState().setActiveView("git");
  expect(useApp.getState().activeView).toBe("git");
});

it("effectiveView returns the active view while it is visible", () => {
  expect(effectiveView("git", allVisible)).toBe("git");
});

it("falls back to the first visible section when the active one is hidden", () => {
  const vis = { ...allVisible, files: false, git: false };
  expect(effectiveView("git", vis)).toBe("secrets");
});

it("returns null when every section is hidden", () => {
  const vis = Object.fromEntries(
    SECTION_META.map((m) => [m.id, false]),
  ) as SectionVisibility;
  expect(effectiveView("files", vis)).toBeNull();
});
