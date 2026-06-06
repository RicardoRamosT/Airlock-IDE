import { beforeEach, describe, expect, it } from "vitest";
import { type TabTerminals, useApp } from "./store";

// Pristine store state (incl. all action fns) captured ONCE. The actions are
// immutable (spreads/maps), so this reference stays clean and can be restored
// before every test via setState(initialState, true).
const initialState = useApp.getState();

// The store calls window.airlock.workspaceSetActive (switchTab / closeTab
// folder-neighbor-promote) and workspaceClose (closeTab to a blank target /
// switchTab to a blank tab). The test env is environment:"node" -> no window
// global, so define one and record both: the roots main is pointed at, and how
// many times the root is cleared.
const setActiveCalls: string[] = [];
let closeCalls = 0;

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    airlock: {
      workspaceSetActive: (p: string) => {
        setActiveCalls.push(p);
        return Promise.resolve();
      },
      workspaceClose: () => {
        closeCalls += 1;
        return Promise.resolve();
      },
    },
  };
  setActiveCalls.length = 0;
  closeCalls = 0;
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

describe("initial state", () => {
  it("starts with exactly one blank tab, active, with empty terminals", () => {
    const s = get();

    // The window always has >= 1 tab: a single blank tab (root null).
    expect(s.tabs).toHaveLength(1);
    const id = tabIdAt(0);
    expect(s.tabs[0]?.root).toBeNull();

    // activeTabId is a non-null string pointing at that blank tab.
    expect(s.activeTabId).toBe(id);
    expect(typeof s.activeTabId).toBe("string");

    // top-level per-project state is the no-folder state
    expect(s.root).toBeNull();
    expect(s.selectedFile).toBeNull();
    expect(s.secrets).toEqual([]);

    // the blank tab has a terminal slice keyed by its id; no parked snapshots
    expect(tt(id)).toEqual(EMPTY);
    expect(s.tabSnapshots).toEqual({});
  });
});

describe("openProject", () => {
  it("appends a project tab and parks the outgoing (blank) tab's snapshot", () => {
    const blankId = tabIdAt(0);

    get().openProject("/a");
    const s = get();

    // appended a 2nd tab, made it active, with its own root
    expect(s.tabs).toHaveLength(2);
    const aId = tabIdAt(1);
    expect(s.tabs[1]?.root).toBe("/a");
    expect(s.activeTabId).toBe(aId);
    expect(s.root).toBe("/a");

    // new tab gets a fresh empty terminal set; the blank tab is untouched
    expect(tt(aId)).toEqual(EMPTY);
    expect(tt(blankId)).toEqual(EMPTY);

    // the outgoing blank tab's snapshot was parked
    expect(s.tabSnapshots[blankId]).toBeDefined();
  });

  it("parks the outgoing tab's snapshot when opening a second project", () => {
    get().openProject("/a");
    const aId = tabIdAt(1);
    get().openProject("/b");
    const s = get();

    expect(s.tabs).toHaveLength(3); // blank + /a + /b
    expect(s.activeTabId).toBe(tabIdAt(2));
    expect(s.root).toBe("/b");
    // a was parked when b opened
    expect(s.tabSnapshots[aId]).toBeDefined();
  });
});

describe("openBlankTab", () => {
  it("appends a blank tab, activates it, parks the previous tab's snapshot", () => {
    // open a project first so the active tab has a snapshot worth parking
    get().openProject("/a");
    const aId = tabIdAt(1);

    get().openBlankTab();
    const s = get();

    // appended a blank tab (root null) and made it active
    expect(s.tabs).toHaveLength(3); // initial blank + /a + new blank
    const blankId = tabIdAt(2);
    expect(s.tabs[2]?.root).toBeNull();
    expect(s.activeTabId).toBe(blankId);

    // top-level is the no-folder state; new tab has empty terminals
    expect(s.root).toBeNull();
    expect(tt(blankId)).toEqual(EMPTY);

    // the previous (project) tab's snapshot was parked
    expect(s.tabSnapshots[aId]).toBeDefined();
  });
});

describe("fillActiveTab / setRoot on a blank active tab", () => {
  it("fillActiveTab attaches a folder in place and keeps the tab's terminals", () => {
    const id = tabIdAt(0); // the initial blank tab is active

    // add a terminal in the blank tab (e.g. a running session)
    const t1 = get().addTerminal();
    expect(tt(id).terminals.map((t) => t.id)).toEqual([t1]);

    get().fillActiveTab("/a");
    const s = get();

    // same tab id, now with a root -- tabs.length unchanged (no new tab)
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.id).toBe(id);
    expect(s.tabs[0]?.root).toBe("/a");
    expect(s.activeTabId).toBe(id);
    expect(s.root).toBe("/a");

    // the blank tab's terminal SURVIVES the attach (not reset)
    expect(tt(id).terminals.map((t) => t.id)).toEqual([t1]);
    expect(tt(id).activeTerminalId).toBe(t1);
  });

  it("fillActiveTab clears any parked snapshot for the tab", () => {
    // Park a snapshot for the blank tab by opening a project (parks blank), then
    // come back to it. Simpler: directly seed a snapshot via switch round-trip.
    const blankId = tabIdAt(0);
    get().openProject("/a"); // parks blankId's snapshot
    expect(get().tabSnapshots[blankId]).toBeDefined();

    get().switchTab(blankId); // back to the blank tab (still blank)
    expect(get().activeTabId).toBe(blankId);

    get().fillActiveTab("/b");
    // the parked snapshot for the now-filled tab is cleared
    expect(get().tabSnapshots[blankId]).toBeUndefined();
  });

  it("setRoot(string) on a blank active tab routes to fillActiveTab", () => {
    const id = tabIdAt(0); // blank, active
    const t1 = get().addTerminal();

    get().setRoot("/a");
    const s = get();

    // attached in place: no new tab, terminals kept
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.id).toBe(id);
    expect(s.root).toBe("/a");
    expect(tt(id).terminals.map((t) => t.id)).toEqual([t1]);
  });
});

describe("switchTab", () => {
  it("round-trips per-project state across a park+restore (no bleed)", () => {
    // open A, give it a selectedFile
    get().openProject("/a");
    const aId = tabIdAt(1);
    get().setSelected("/a/file.ts", null);

    // open B, give it a DIFFERENT selectedFile
    get().openProject("/b");
    const bId = tabIdAt(2);
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
    const aId = tabIdAt(1);
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
    const aId = tabIdAt(1);
    get().openProject("/b");
    setActiveCalls.length = 0;

    get().switchTab(aId);
    expect(setActiveCalls[setActiveCalls.length - 1]).toBe("/a");
  });

  it("clears main when switching to a blank tab (root null)", () => {
    const blankId = tabIdAt(0); // initial blank tab
    get().openProject("/a"); // now on /a; blank parked
    setActiveCalls.length = 0;
    closeCalls = 0;

    get().switchTab(blankId);
    expect(get().root).toBeNull();
    // a blank target clears main rather than pointing it anywhere
    expect(setActiveCalls).toEqual([]);
    expect(closeCalls).toBe(1);
  });
});

describe("closeTab", () => {
  it("promotes the previous neighbor (idx-1) when closing the active tab", () => {
    get().openProject("/a");
    get().openProject("/b");
    get().openProject("/c");
    const bId = tabIdAt(2);
    const cId = tabIdAt(3);

    get().closeTab(cId);
    const s = get();

    expect(s.activeTabId).toBe(bId);
    expect(s.root).toBe("/b");
    expect(s.tabs.map((t) => t.root)).toEqual([null, "/a", "/b"]);
    // c's terminal + snapshot maps cleaned up
    expect(s.tabTerminals[cId]).toBeUndefined();
    expect(s.tabSnapshots[cId]).toBeUndefined();
    // promoted a folder neighbor -> main pointed at it
    expect(setActiveCalls[setActiveCalls.length - 1]).toBe("/b");
  });

  it("clears main when the promoted neighbor is a blank tab", () => {
    // initial blank tab, then open /a; closing /a promotes the blank neighbor.
    const blankId = tabIdAt(0);
    get().openProject("/a");
    const aId = tabIdAt(1);
    setActiveCalls.length = 0;
    closeCalls = 0;

    get().closeTab(aId);
    const s = get();

    expect(s.activeTabId).toBe(blankId);
    expect(s.root).toBeNull();
    expect(s.tabs.map((t) => t.root)).toEqual([null]);
    // blank neighbor -> main is CLEARED, not pointed anywhere
    expect(setActiveCalls).toEqual([]);
    expect(closeCalls).toBe(1);
  });

  it("closing a background tab leaves the active tab put", () => {
    get().openProject("/a");
    get().openProject("/b");
    const aId = tabIdAt(1);
    const bId = tabIdAt(2);
    setActiveCalls.length = 0;
    closeCalls = 0;

    get().closeTab(aId);
    const s = get();

    expect(s.activeTabId).toBe(bId);
    expect(s.root).toBe("/b");
    expect(s.tabs.map((t) => t.root)).toEqual([null, "/b"]);
    expect(s.tabTerminals[aId]).toBeUndefined();
    expect(s.tabSnapshots[aId]).toBeUndefined();
    // background close does NOT re-sync main (active root unchanged)
    expect(setActiveCalls).toEqual([]);
    expect(closeCalls).toBe(0);
  });

  it("closing the LAST tab opens a fresh blank tab and clears main", () => {
    // fill the initial blank tab so there is a single project tab to close
    get().fillActiveTab("/a");
    const aId = tabIdAt(0);
    expect(get().tabs).toHaveLength(1);
    setActiveCalls.length = 0;
    closeCalls = 0;

    get().closeTab(aId);
    const s = get();

    // NOT a dead state: a fresh blank tab exists and is active
    expect(s.tabs).toHaveLength(1);
    const blankId = tabIdAt(0);
    expect(blankId).not.toBe(aId);
    expect(s.tabs[0]?.root).toBeNull();
    expect(s.activeTabId).toBe(blankId);
    expect(s.root).toBeNull();
    // the fresh blank tab has an empty terminal set; closed tab's maps gone
    expect(tt(blankId)).toEqual(EMPTY);
    expect(s.tabTerminals[aId]).toBeUndefined();
    expect(s.tabSnapshots).toEqual({});
    // the last-tab close CLEARS main's root (agent stops resolving the project)
    expect(closeCalls).toBe(1);
    expect(setActiveCalls).toEqual([]);
  });
});

describe("setRoot dispatch (tabs vs windows mode)", () => {
  it("windows mode + project-active tab: setRoot replaces in place", () => {
    get().setOpenProjectsAsTabs(false);

    // the initial tab is blank -> first setRoot fills it in place
    get().setRoot("/a");
    expect(get().tabs).toHaveLength(1);
    const id = tabIdAt(0);
    expect(get().root).toBe("/a");

    // now the active tab HAS a project; park a snapshot so we can prove replace
    // clears it
    get().setSelected("/a/file.ts", null);
    const t1 = get().addTerminal();
    expect(tt(id).terminals.map((t) => t.id)).toEqual([t1]);

    get().setRoot("/b"); // replaceActiveProject: same tab id, new root
    const s = get();

    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.id).toBe(id);
    expect(s.root).toBe("/b");
    // fresh empty terminals for the replaced tab (terminals RESET on replace)
    expect(tt(id)).toEqual(EMPTY);
    // parked snapshot for this tab cleared
    expect(s.tabSnapshots[id]).toBeUndefined();
    // live per-project state reset for the new project
    expect(s.selectedFile).toBeNull();
  });

  it("tabs mode + project-active tab: setRoot appends a new tab", () => {
    // default openProjectsAsTabs === true
    get().setRoot("/a"); // initial blank tab -> filled in place
    expect(get().tabs).toHaveLength(1);
    expect(get().root).toBe("/a");

    get().setRoot("/b"); // active tab has a project -> NEW tab
    expect(get().tabs).toHaveLength(2);
    expect(get().tabs.map((t) => t.root)).toEqual(["/a", "/b"]);
    expect(get().root).toBe("/b");
  });

  it("tabs mode: setRoot(null) closes the active tab; last close -> blank tab", () => {
    get().setRoot("/a"); // fills initial blank
    get().setRoot("/b"); // appends /b
    expect(get().tabs).toHaveLength(2);

    get().setRoot(null); // closes /b; /a remains
    expect(get().tabs).toHaveLength(1);
    expect(get().tabs[0]?.root).toBe("/a");

    get().setRoot(null); // closes the last tab -> a fresh blank tab
    expect(get().tabs).toHaveLength(1);
    expect(get().tabs[0]?.root).toBeNull();
    expect(get().activeTabId).toBe(tabIdAt(0));
    expect(get().root).toBeNull();
  });
});

describe("terminal routing to a background tab (findOwningTabId)", () => {
  it("setTerminalTitle/removeTerminal hit the owning tab, not the active one", () => {
    // addTerminal targets the ACTIVE tab and returns the generated id, so open A,
    // add t1 (lands in A), then open B (A is now background), add t2 (lands in B).
    get().openProject("/a");
    const aId = tabIdAt(1);
    const t1 = get().addTerminal();

    get().openProject("/b");
    const bId = tabIdAt(2);
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
    const aId = tabIdAt(1);
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

describe("runningNotice", () => {
  it("setRunningNotice sets and clears the field", () => {
    // starts cleared
    expect(get().runningNotice).toBeNull();

    get().setRunningNotice({ terminalId: "term-7" });
    expect(get().runningNotice).toEqual({ terminalId: "term-7" });

    get().setRunningNotice(null);
    expect(get().runningNotice).toBeNull();
  });
});
