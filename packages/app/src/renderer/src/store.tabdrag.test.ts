import { beforeEach, expect, it, vi } from "vitest";
import { useApp } from "./store";

const initial = useApp.getState();
// Spies for the two calls that tell MAIN which project a window is focused on. That
// root drives the OS window title and rootForEvent-based IPC, so a tab move that
// forgets them leaves the window pointed at a project it no longer shows.
let workspaceSetActive: ReturnType<typeof vi.fn>;
let workspaceClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // The tab actions report open roots over IPC and node env has no window --
  // same stub pattern as store.autoClaude.test.ts.
  workspaceSetActive = vi.fn(() => Promise.resolve(undefined));
  workspaceClose = vi.fn(() => Promise.resolve(undefined));
  (globalThis as { window?: unknown }).window = {
    airlock: new Proxy(
      { workspaceSetActive, workspaceClose },
      {
        get: (t, p) =>
          p in t
            ? (t as Record<string, unknown>)[p as string]
            : () => Promise.resolve(undefined),
      },
    ),
  };
  useApp.setState(initial, true);
});

// Two project tabs, the second holding one LIVE pty.
function seedTwo(): string {
  const s = useApp.getState();
  s.openProject("/a");
  s.openProject("/b");
  const bId = useApp.getState().activeTabId;
  useApp.setState((st) => ({
    tabTerminals: {
      ...st.tabTerminals,
      [bId]: {
        terminals: [
          { id: "term-9", title: "zsh", renamed: false, ptyId: "pty-9" },
        ],
        activeTerminalId: "term-9",
        splitTerminalId: null,
        claudeAutoId: null,
      },
    },
  }));
  return bId;
}

it("detachTab returns the payload, drops the tab, and marks its ptys as moving", () => {
  const bId = seedTwo();
  const payload = useApp.getState().detachTab(bId);
  expect(payload?.root).toBe("/b");
  expect(payload?.terminals).toEqual([
    { id: "term-9", ptyId: "pty-9", title: "zsh" },
  ]);
  expect(payload?.activeTerminalId).toBe("term-9");
  const s = useApp.getState();
  expect(s.tabs.some((t) => t.id === bId)).toBe(false);
  expect(s.tabState[bId]).toBeUndefined();
  expect(s.tabTerminals[bId]).toBeUndefined();
  // The pane's unmount consults this and SKIPS ptyKill, so the session lives.
  expect(s.movingPtyIds).toContain("pty-9");
});

it("detachTab promotes a surviving tab when the detached one was focused", () => {
  const bId = seedTwo(); // "/b" is active
  useApp.getState().detachTab(bId);
  const s = useApp.getState();
  expect(s.activeTabId).not.toBe(bId);
  expect(s.root).toBe("/a"); // mirrored to the promoted tab
});

it("detachTab refuses the window's last tab (already its own window)", () => {
  const s0 = useApp.getState();
  s0.openProject("/only");
  const only = useApp.getState().activeTabId;
  useApp.setState((st) => ({ tabs: st.tabs.filter((t) => t.id === only) }));
  expect(useApp.getState().detachTab(only)).toBeNull();
  expect(useApp.getState().tabs).toHaveLength(1);
});

it("detachTab dissolves a split it was a member of", () => {
  const bId = seedTwo();
  const aId = useApp.getState().tabs[0]?.id ?? "";
  useApp.setState({ split: { a: aId, b: bId } });
  useApp.getState().detachTab(bId);
  expect(useApp.getState().split).toBeNull();
});

it("adoptTab inserts a focused tab and queues its ptys for adoption", () => {
  useApp.getState().openProject("/a");
  useApp.getState().adoptTab({
    root: "/b",
    label: "Bee",
    terminals: [{ id: "term-9", ptyId: "pty-9", title: "zsh" }],
    activeTerminalId: "term-9",
    state: null,
  });
  const s = useApp.getState();
  const adopted = s.tabs.find((t) => t.root === "/b");
  if (!adopted) throw new Error("tab was not adopted");
  expect(s.activeTabId).toBe(adopted.id);
  expect(s.tabRenames[adopted.id]).toBe("Bee");
  expect(s.tabTerminals[adopted.id]?.terminals[0]?.ptyId).toBe("pty-9");
  expect(s.tabTerminals[adopted.id]?.activeTerminalId).toBe("term-9");
  // Single-use: the pane adopts the live pty instead of spawning, once.
  expect(useApp.getState().takePendingAdopt("term-9")).toBe("pty-9");
  expect(useApp.getState().takePendingAdopt("term-9")).toBeNull();
});

it("forgetMovingPty is single-use so a merged-back tab stays killable", () => {
  const bId = seedTwo();
  useApp.getState().detachTab(bId);
  expect(useApp.getState().movingPtyIds).toContain("pty-9");
  // The departing pane consumes the marker on unmount.
  useApp.getState().forgetMovingPty("pty-9");
  expect(useApp.getState().movingPtyIds).not.toContain("pty-9");
  // Forgetting an unknown id is a no-op, not a crash.
  useApp.getState().forgetMovingPty("pty-nope");
  expect(useApp.getState().movingPtyIds).toEqual([]);
});

it("a detach/adopt round trip preserves the pty and the pane scene", () => {
  const bId = seedTwo();
  const scene = useApp.getState().tabState[bId];
  const payload = useApp.getState().detachTab(bId);
  if (!payload) throw new Error("detach refused");
  useApp.getState().adoptTab(payload);
  const s = useApp.getState();
  const back = s.tabs.find((t) => t.root === "/b");
  if (!back) throw new Error("tab did not come back");
  expect(s.tabTerminals[back.id]?.terminals[0]?.ptyId).toBe("pty-9");
  expect(s.tabState[back.id]).toEqual(scene);
});

it("adoptTab re-points main at the adopted project", () => {
  // The adopted tab is focused in the renderer, so main must be told -- otherwise
  // this window's recorded root stays whatever it was (or nothing).
  useApp.getState().openProject("/a");
  workspaceSetActive.mockClear();
  useApp.getState().adoptTab({
    root: "/b",
    label: null,
    terminals: [{ id: "term-9", ptyId: "pty-9", title: "zsh" }],
    activeTerminalId: "term-9",
    state: null,
  });
  expect(workspaceSetActive).toHaveBeenCalledWith("/b");
});

it("adopting a BLANK tab clears main rather than leaving it stale", () => {
  useApp.getState().openProject("/a");
  workspaceClose.mockClear();
  useApp.getState().adoptTab({
    root: null,
    label: null,
    terminals: [],
    activeTerminalId: null,
    state: null,
  });
  expect(workspaceClose).toHaveBeenCalled();
});

it("detachTab re-points MAIN at the tab left behind", () => {
  // Otherwise this window's recorded root stays the project that just LEFT it.
  const bId = seedTwo(); // "/b" focused, "/a" also open
  workspaceSetActive.mockClear();
  useApp.getState().detachTab(bId);
  expect(workspaceSetActive).toHaveBeenCalledWith("/a");
});
