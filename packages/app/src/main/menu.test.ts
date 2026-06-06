import { describe, expect, it, vi } from "vitest";
import type { Section, SectionVisibility } from "../shared/ipc";
import { newMenuItem, recentSubmenuItems, sectionSubmenuItems } from "./menu";

const ALL_VISIBLE: SectionVisibility = {
  files: true,
  secrets: true,
  git: true,
  activity: true,
  databases: true,
  docker: true,
  host: true,
  audit: true,
};

describe("sectionSubmenuItems", () => {
  it("returns the eight sections in order as labelled checkboxes", () => {
    const items = sectionSubmenuItems(ALL_VISIBLE, () => {});
    expect(items.map((i) => i.label)).toEqual([
      "Files",
      "Secrets",
      "Git",
      "Activity",
      "Databases",
      "Docker",
      "Host",
      "Audit",
    ]);
    expect(items.every((i) => i.type === "checkbox")).toBe(true);
  });

  it("mirrors visibility into each item's checked flag", () => {
    const items = sectionSubmenuItems(
      { ...ALL_VISIBLE, docker: false },
      () => {},
    );
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i.checked]));
    expect(byLabel.Docker).toBe(false);
    expect(byLabel.Files).toBe(true);
  });

  it("treats a missing section as checked (visible by default)", () => {
    // A partial map (no `audit` key) must still render audit checked.
    const partial = { files: true } as SectionVisibility;
    const items = sectionSubmenuItems(partial, () => {});
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i.checked]));
    expect(byLabel.Audit).toBe(true);
  });

  it("invokes onToggle with the section id and the new checked state", () => {
    const onToggle = vi.fn<(id: Section, visible: boolean) => void>();
    const items = sectionSubmenuItems(ALL_VISIBLE, onToggle);
    const docker = items.find((i) => i.label === "Docker");
    expect(docker).toBeDefined();
    // Simulate the user unchecking Docker.
    docker?.click?.(
      { checked: false } as never,
      undefined as never,
      undefined as never,
    );
    expect(onToggle).toHaveBeenCalledWith("docker", false);
  });
});

describe("recentSubmenuItems", () => {
  it("renders an item per folder with a click that picks the path", () => {
    const picked: string[] = [];
    const items = recentSubmenuItems(["/a/proj", "/b/app"], (p) =>
      picked.push(p),
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.label).toBe("proj");
    (items[0]?.click as () => void)?.();
    expect(picked).toEqual(["/a/proj"]);
  });
  it("shows a disabled placeholder when empty", () => {
    const items = recentSubmenuItems([], () => {});
    expect(items).toHaveLength(1);
    expect(items[0]?.enabled).toBe(false);
  });
});

// newMenuItem is the exact item applyAppMenu uses as the File submenu's first
// entry AND the only item applyDockMenu installs, so asserting on it directly
// proves the relabel for both the menu and the dock without standing up
// Electron's Menu.setApplicationMenu.
describe("newMenuItem", () => {
  it("is 'New Tab' (Cmd+T) when openProjectsAsTabs is true", () => {
    const item = newMenuItem(true);
    expect(item.label).toBe("New Tab");
    expect(item.accelerator).toBe("CmdOrCtrl+T");
  });
  it("is 'New Window' (Cmd+Shift+N) when openProjectsAsTabs is false", () => {
    const item = newMenuItem(false);
    expect(item.label).toBe("New Window");
    expect(item.accelerator).toBe("CmdOrCtrl+Shift+N");
  });
});
