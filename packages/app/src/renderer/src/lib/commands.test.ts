import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { buildCommands } from "./commands";

const initialState = useApp.getState();
let setSectionVisibility: ReturnType<typeof vi.fn>;
let prefsSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setSectionVisibility = vi.fn(() => Promise.resolve(undefined));
  prefsSet = vi.fn(() => Promise.resolve(undefined));
  (globalThis as { window?: unknown }).window = {
    airlock: {
      setSectionVisibility,
      prefsSet,
      workspaceClose: () => Promise.resolve(),
    },
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

it("offers Show <Section> commands that activate the view", () => {
  useApp.setState({ sidebarVisible: false });
  const cmds = buildCommands(useApp.getState(), () => {});
  const show = cmds.find((c) => c.id === "show-section-git");
  expect(show?.title).toBe("Show Git");
  show?.run();
  expect(useApp.getState().activeView).toBe("git");
  expect(useApp.getState().sidebarVisible).toBe(true);
  expect(prefsSet).toHaveBeenCalledWith({
    activeView: "git",
    sidebarVisible: true,
  });
});

it("omits Show commands for hidden sections but keeps their toggles", () => {
  useApp.setState({
    sectionVisibility: {
      ...useApp.getState().sectionVisibility,
      git: false,
    },
  });
  const cmds = buildCommands(useApp.getState(), () => {});
  expect(cmds.find((c) => c.id === "show-section-git")).toBeUndefined();
  expect(cmds.find((c) => c.id === "toggle-section-git")).toBeTruthy();
});
