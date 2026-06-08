import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { buildCommands } from "./commands";

const initialState = useApp.getState();
let setSectionVisibility: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setSectionVisibility = vi.fn(() => Promise.resolve(undefined));
  (globalThis as { window?: unknown }).window = {
    airlock: { setSectionVisibility, workspaceClose: () => Promise.resolve() },
  };
  useApp.setState(initialState, true);
});
afterEach(() => useApp.setState(initialState, true));

it("includes core + per-section commands", () => {
  const cmds = buildCommands(useApp.getState(), () => {});
  const ids = cmds.map((c) => c.id);
  expect(ids).toContain("go-to-file");
  expect(ids).toContain("new-terminal");
  expect(ids).toContain("toggle-section-git");
});

it("Go to File runs the injected callback", () => {
  const goToFiles = vi.fn();
  const cmds = buildCommands(useApp.getState(), goToFiles);
  cmds.find((c) => c.id === "go-to-file")?.run();
  expect(goToFiles).toHaveBeenCalledOnce();
});

it("a section toggle flips that section via the IPC", () => {
  const cmds = buildCommands(useApp.getState(), () => {});
  // git defaults visible -> toggling asks to hide it.
  cmds.find((c) => c.id === "toggle-section-git")?.run();
  expect(setSectionVisibility).toHaveBeenCalledWith("git", false);
});

it("New Tab opens a blank tab", () => {
  const before = useApp.getState().tabs.length;
  buildCommands(useApp.getState(), () => {})
    .find((c) => c.id === "new-tab")
    ?.run();
  expect(useApp.getState().tabs.length).toBe(before + 1);
});
