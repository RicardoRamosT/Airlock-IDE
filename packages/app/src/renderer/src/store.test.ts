import { beforeEach, describe, expect, it } from "vitest";
import { IMPLICIT_TAB_ID, type TabTerminals, useApp } from "./store";

// Pristine store state (incl. all action fns) captured ONCE. The actions are
// immutable (spreads/maps), so this reference stays clean and can be restored
// before every test via setState(initialState, true).
const initialState = useApp.getState();

// The store calls window.airlock.workspaceSetActive in switchTab/closeTab. The
// test env is environment:"node" -> no window global, so define one and record
// every root it is pointed at.
const setActiveCalls: string[] = [];

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    airlock: {
      workspaceSetActive: (p: string) => {
        setActiveCalls.push(p);
        return Promise.resolve();
      },
    },
  };
  setActiveCalls.length = 0;
  useApp.setState(initialState, true);
});

// --- helpers -------------------------------------------------------------

const get = () => useApp.getState();

// id of the nth tab (0-based) in current tab order. Asserts presence so the
// rest of a test can rely on a real id (noUncheckedIndexedAccess makes the raw
// index T | undefined).
const tabIdAt = (i: number): string => {
  const tab = get().tabs[i];
  if (!tab) throw new Error(`no tab at index ${i}`);
  return tab.id;
};

// A tab's terminal state, asserted present (raw index is TabTerminals |
// undefined under noUncheckedIndexedAccess).
const tt = (tabId: string): TabTerminals => {
  const entry = get().tabTerminals[tabId];
  if (!entry) throw new Error(`no tabTerminals for ${tabId}`);
  return entry;
};

const EMPTY: TabTerminals = {
  terminals: [],
  activeTerminalId: null,
  splitTerminalId: null,
};

describe("openProject", () => {
  it("opens the first project from the implicit/no-project state", () => {
    expect(get().activeTabId).toBeNull();

    get().openProject("/a");
    const s = get();

    expect(s.tabs).toHaveLength(1);
    const newId = tabIdAt(0);
    expect(s.tabs[0]?.root).toBe("/a");
    expect(s.activeTabId).toBe(newId);
    expect(s.root).toBe("/a");

    // new tab AND the implicit tab both have a fresh (empty) terminal set
    expect(tt(newId)).toEqual(EMPTY);
    expect(tt(IMPLICIT_TAB_ID)).toEqual(EMPTY);
  });

  it("parks the outgoing tab's snapshot when opening a second project", () => {
    get().openProject("/a");
    const aId = tabIdAt(0);
    get().openProject("/b");
    const s = get();

    expect(s.tabs).toHaveLength(2);
    expect(s.activeTabId).toBe(tabIdAt(1));
    expect(s.root).toBe("/b");
    // a was parked when b opened
    expect(s.tabSnapshots[aId]).toBeDefined();
  });
});

describe("switchTab", () => {
  it("round-trips per-project state across a park+restore (no bleed)", () => {
    // open A, give it a selectedFile
    get().openProject("/a");
    const aId = tabIdAt(0);
    get().setSelected("/a/file.ts", null);

    // open B, give it a DIFFERENT selectedFile
    get().openProject("/b");
    const bId = tabIdAt(1);
    get().setSelected("/b/file.ts", null);

    // switch back to A -> A's root + selectedFile restored
    get().switchTab(aId);
    expect(get().root).toBe("/a");
    expect(get().selectedFile).toBe("/a/file.ts");

    // switch to B -> B's value, proving the two never bled into each other
    get().switchTab(bId);
    expect(get().root).toBe("/b");
    expect(get().selectedFile).toBe("/b/file.ts");
  });

  it("self-switch is a no-op for the tab model", () => {
    get().openProject("/a");
    const aId = tabIdAt(0);
    get().setSelected("/a/file.ts", null);
    const before = get();

    get().switchTab(aId);
    const after = get();

    // tab model + per-project state unchanged
    expect(after.activeTabId).toBe(before.activeTabId);
    expect(after.root).toBe(before.root);
    expect(after.selectedFile).toBe(before.selectedFile);
    expect(after.tabs).toEqual(before.tabs);
    // set() short-circuits, but workspaceSetActive runs unconditionally after
    // set() using the (unchanged) active root -> harmless same-root re-point.
    expect(setActiveCalls).toEqual(["/a"]);
  });

  it("switching to an unknown id is a no-op", () => {
    get().openProject("/a");
    const before = get();
    setActiveCalls.length = 0;

    get().switchTab("does-not-exist");
    const after = get();

    expect(after.activeTabId).toBe(before.activeTabId);
    expect(after.root).toBe(before.root);
    expect(after.tabs).toEqual(before.tabs);
    // unknown-id set() returns {} (active unchanged); the post-set re-point still
    // fires with the still-active root.
    expect(setActiveCalls).toEqual(["/a"]);
  });

  it("points main at the newly-active tab's root after a real switch", () => {
    get().openProject("/a");
    const aId = tabIdAt(0);
    get().openProject("/b");
    setActiveCalls.length = 0;

    get().switchTab(aId);
    expect(setActiveCalls[setActiveCalls.length - 1]).toBe("/a");
  });
});

describe("closeTab", () => {
  it("promotes the previous neighbor (idx-1) when closing the active tab", () => {
    get().openProject("/a");
    get().openProject("/b");
    get().openProject("/c");
    const bId = tabIdAt(1);
    const cId = tabIdAt(2);

    get().closeTab(cId);
    const s = get();

    expect(s.activeTabId).toBe(bId);
    expect(s.root).toBe("/b");
    expect(s.tabs.map((t) => t.root)).toEqual(["/a", "/b"]);
    // c's terminal + snapshot maps cleaned up
    expect(s.tabTerminals[cId]).toBeUndefined();
    expect(s.tabSnapshots[cId]).toBeUndefined();
  });

  it("closing a background tab leaves the active tab put", () => {
    get().openProject("/a");
    get().openProject("/b");
    const aId = tabIdAt(0);
    const bId = tabIdAt(1);

    get().closeTab(aId);
    const s = get();

    expect(s.activeTabId).toBe(bId);
    expect(s.root).toBe("/b");
    expect(s.tabs.map((t) => t.root)).toEqual(["/b"]);
    expect(s.tabTerminals[aId]).toBeUndefined();
    expect(s.tabSnapshots[aId]).toBeUndefined();
  });

  it("closing the last tab returns to the no-project state", () => {
    get().openProject("/a");
    const aId = tabIdAt(0);

    get().closeTab(aId);
    const s = get();

    expect(s.activeTabId).toBeNull();
    expect(s.root).toBeNull();
    expect(s.tabs).toHaveLength(0);
    // implicit tab reset to a fresh empty terminal set
    expect(tt(IMPLICIT_TAB_ID)).toEqual(EMPTY);
  });
});

describe("setRoot dispatch (tabs vs windows mode)", () => {
  it("windows mode: setRoot replaces the active tab in place", () => {
    get().setOpenProjectsAsTabs(false);

    get().setRoot("/a"); // first open -> delegates to openProject
    expect(get().tabs).toHaveLength(1);
    const id = tabIdAt(0);

    // park a snapshot for this tab so we can prove replace clears it
    get().setSelected("/a/file.ts", null);

    get().setRoot("/b"); // replaceActiveProject: same tab id, new root
    const s = get();

    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.id).toBe(id);
    expect(s.root).toBe("/b");
    // fresh empty terminals for the replaced tab
    expect(tt(id)).toEqual(EMPTY);
    // parked snapshot for this tab cleared
    expect(s.tabSnapshots[id]).toBeUndefined();
    // live per-project state reset for the new project
    expect(s.selectedFile).toBeNull();
  });

  it("tabs mode: setRoot appends, setRoot(null) clears", () => {
    // default openProjectsAsTabs === true
    get().setRoot("/a");
    get().setRoot("/b");
    expect(get().tabs).toHaveLength(2);

    get().setRoot(null); // closes the active tab; one tab remains
    expect(get().tabs).toHaveLength(1);
    expect(get().tabs[0]?.root).toBe("/a");

    get().setRoot(null); // closes the last tab -> no-project state
    expect(get().tabs).toHaveLength(0);
    expect(get().activeTabId).toBeNull();
    expect(get().root).toBeNull();
  });
});

describe("terminal routing to a background tab (findOwningTabId)", () => {
  it("setTerminalTitle/removeTerminal hit the owning tab, not the active one", () => {
    // addTerminal targets the ACTIVE tab and returns the generated id, so open A,
    // add t1 (lands in A), then open B (A is now background), add t2 (lands in B).
    get().openProject("/a");
    const aId = tabIdAt(0);
    const t1 = get().addTerminal();

    get().openProject("/b");
    const bId = tabIdAt(1);
    const t2 = get().addTerminal();

    // sanity: each terminal landed in its own tab
    expect(tt(aId).terminals.map((t) => t.id)).toEqual([t1]);
    expect(tt(bId).terminals.map((t) => t.id)).toEqual([t2]);

    // rename t1 (owned by the now-BACKGROUND tab a)
    get().setTerminalTitle(t1, "renamed", true);
    expect(tt(aId).terminals[0]?.title).toBe("renamed");
    expect(tt(aId).terminals[0]?.renamed).toBe(true);
    // b untouched
    expect(tt(bId).terminals[0]?.title).not.toBe("renamed");

    // remove t1 from background tab a; b unaffected
    get().removeTerminal(t1);
    expect(tt(aId).terminals).toHaveLength(0);
    expect(tt(bId).terminals.map((t) => t.id)).toEqual([t2]);
  });
});

describe("terminal preservation across switches", () => {
  it("switching away from a tab never clears its terminals", () => {
    get().openProject("/a");
    const aId = tabIdAt(0);
    const t1 = get().addTerminal();

    // open B (switch away from A) -> A's terminal survives
    get().openProject("/b");
    expect(tt(aId).terminals.map((t) => t.id)).toEqual([t1]);

    // switch back to A -> still there (switch never mutates any tab's terminals)
    get().switchTab(aId);
    expect(tt(aId).terminals.map((t) => t.id)).toEqual([t1]);
    expect(tt(aId).activeTerminalId).toBe(t1);
  });
});
