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
// The store also reports the window's open-tab roots via window.airlock
// .workspaceRoots on every set-changing tab action (open/fill/replace/close).
// Record the latest reported set so the stub satisfies those calls (without it
// the actions would call an undefined and throw).
let lastReportedRoots: string[] | null = null;

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
      workspaceRoots: (roots: string[]) => {
        lastReportedRoots = roots;
        return Promise.resolve();
      },
    },
  };
  setActiveCalls.length = 0;
  closeCalls = 0;
  lastReportedRoots = null;
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
  it("starts with exactly one blank tab, active, mirrored, no split", () => {
    const s = get();

    // The window always has >= 1 tab: a single blank tab (root null).
    expect(s.tabs).toHaveLength(1);
    const id = tabIdAt(0);
    expect(s.tabs[0]?.root).toBeNull();

    // activeTabId is a non-null string pointing at that blank tab; no split.
    expect(s.activeTabId).toBe(id);
    expect(typeof s.activeTabId).toBe("string");
    expect(s.split).toBeNull();

    // top-level per-project state is the no-folder state (mirror of tabState)
    expect(s.root).toBeNull();
    expect(s.selectedFile).toBeNull();
    expect(s.secrets).toEqual([]);

    // tabState is the source of truth: one entry for the blank tab, root null
    expect(Object.keys(s.tabState)).toEqual([id]);
    expect(s.tabState[id]?.root).toBeNull();
    expect(s.tabState[id]?.selectedFile).toBeNull();

    // the blank tab has a terminal slice keyed by its id
    expect(tt(id)).toEqual(EMPTY);
  });
});

describe("openProject", () => {
  it("appends a project tab, mirrors it, and keeps the prior tab's state in tabState", () => {
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

    // both tabs live in tabState (no parking); /a is mirrored to the top level
    expect(s.tabState[blankId]?.root).toBeNull();
    expect(s.tabState[aId]?.root).toBe("/a");
  });

  it("keeps each opened project's state in tabState when opening a second", () => {
    get().openProject("/a");
    const aId = tabIdAt(1);
    get().openProject("/b");
    const s = get();

    expect(s.tabs).toHaveLength(3); // blank + /a + /b
    expect(s.activeTabId).toBe(tabIdAt(2));
    expect(s.root).toBe("/b");
    // a still lives in tabState with its root after b opened
    expect(s.tabState[aId]?.root).toBe("/a");
  });
});

describe("openBlankTab", () => {
  it("appends a blank tab, activates it, keeps the previous tab in tabState", () => {
    // open a project first so the active tab has state worth keeping
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

    // the previous (project) tab's state persists in tabState
    expect(s.tabState[aId]?.root).toBe("/a");
    expect(s.tabState[blankId]?.root).toBeNull();
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
    // the tab's source-of-truth state has the new root too
    expect(s.tabState[id]?.root).toBe("/a");

    // the blank tab's terminal SURVIVES the attach (not reset)
    expect(tt(id).terminals.map((t) => t.id)).toEqual([t1]);
    expect(tt(id).activeTerminalId).toBe(t1);
  });

  it("fillActiveTab resets the tab's project fields for the new root", () => {
    // Give the blank tab a selectedFile, then attach a folder; the fill gives
    // it fresh project fields keyed to the new root (no stale carry-over).
    const id = tabIdAt(0);
    get().setSelected("/scratch/file.ts", null);
    expect(get().tabState[id]?.selectedFile).toBe("/scratch/file.ts");

    get().fillActiveTab("/b");
    const s = get();
    expect(s.tabState[id]?.root).toBe("/b");
    expect(s.tabState[id]?.selectedFile).toBeNull();
    // mirror tracks the fresh state
    expect(s.root).toBe("/b");
    expect(s.selectedFile).toBeNull();
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
  it("round-trips per-project state across a focus change (no bleed)", () => {
    // open A, give it a selectedFile
    get().openProject("/a");
    const aId = tabIdAt(1);
    get().setSelected("/a/file.ts", null);

    // open B, give it a DIFFERENT selectedFile
    get().openProject("/b");
    const bId = tabIdAt(2);
    get().setSelected("/b/file.ts", null);

    // switch back to A -> A's root + selectedFile mirrored to the top level
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
    get().openProject("/a"); // now on /a
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
    // c's terminal + tabState entries cleaned up
    expect(s.tabTerminals[cId]).toBeUndefined();
    expect(s.tabState[cId]).toBeUndefined();
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
    expect(s.tabState[aId]).toBeUndefined();
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
    expect(s.split).toBeNull();
    // the fresh blank tab has an empty terminal set; closed tab's maps gone
    expect(tt(blankId)).toEqual(EMPTY);
    expect(s.tabTerminals[aId]).toBeUndefined();
    // tabState now holds exactly the fresh blank tab
    expect(Object.keys(s.tabState)).toEqual([blankId]);
    expect(s.tabState[blankId]?.root).toBeNull();
    // the last-tab close CLEARS main's root (agent stops resolving the project)
    expect(closeCalls).toBe(1);
    expect(setActiveCalls).toEqual([]);
  });
});

describe("workspace:roots reporting (resolveRoot validation set)", () => {
  it("reports the window's open folder roots on open and close", () => {
    // initial blank tab -> opening /a then /b reports the growing folder set
    get().openProject("/a");
    expect(lastReportedRoots).toEqual(["/a"]);

    get().openProject("/b");
    expect(lastReportedRoots).toEqual(["/a", "/b"]);

    // closing the active /b leaves /a as the only open folder
    get().closeTab(tabIdAt(2));
    expect(lastReportedRoots).toEqual(["/a"]);

    // blank tabs contribute no root (filtered out)
    get().openBlankTab();
    expect(lastReportedRoots).toEqual(["/a"]);
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

    // now the active tab HAS a project; give it state so we can prove replace
    // resets it
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
    // tabState for this tab reset to the new project
    expect(s.tabState[id]?.root).toBe("/b");
    expect(s.tabState[id]?.selectedFile).toBeNull();
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

describe("project split + focus (pair model)", () => {
  it("toggleProjectSplit splits the active tab with a NEW blank secondary, then un-splits", () => {
    get().openProject("/a"); // tabs: [blank, /a], active /a
    const aId = tabIdAt(1);
    const before = get().tabs.length;

    get().toggleProjectSplit();
    const s = get();
    expect(s.split?.a).toBe(aId); // active is the primary (left)
    expect(s.tabs.length).toBe(before + 1); // a new blank secondary was added
    const bId = s.split?.b;
    expect(s.tabs.some((t) => t.id === bId && t.root === null)).toBe(true);
    expect(s.activeTabId).toBe(aId); // focus unchanged (still primary)

    get().toggleProjectSplit(); // showing the split -> un-split
    expect(get().split).toBeNull();
  });

  it("splitActiveWith pairs the active (primary) with a given tab; blank fallback otherwise", () => {
    get().openProject("/a");
    get().openProject("/b"); // active /b
    const aId = tabIdAt(1);
    const bId = tabIdAt(2);

    get().splitActiveWith(aId);
    expect(get().split).toEqual({ a: bId, b: aId }); // active=b primary, a secondary
    expect(get().tabs).toHaveLength(3); // no new tab

    // splitActiveWith(active) -> a fresh blank secondary, not an existing tab
    get().splitActiveWith(bId);
    const s = get();
    expect(s.split?.a).toBe(bId);
    expect(s.split?.b).not.toBe(aId);
    expect(s.tabs).toHaveLength(4); // a blank was added
  });

  it("switchTab to a non-pair tab hides the split (pair persists); to a member shows it", () => {
    get().openProject("/a");
    get().openProject("/b");
    get().openProject("/c"); // active /c
    const aId = tabIdAt(1);
    const bId = tabIdAt(2);
    const cId = tabIdAt(3);

    get().splitActiveWith(aId); // split = { a: c, b: a }, active c
    expect(get().split).toEqual({ a: cId, b: aId });

    // switch to a NON-pair tab (b): split persists, active=b, mirror=/b
    get().switchTab(bId);
    expect(get().split).toEqual({ a: cId, b: aId }); // unchanged (no swap)
    expect(get().activeTabId).toBe(bId);
    expect(get().root).toBe("/b");

    // switch back to a pair member (a): active=a, split unchanged
    get().switchTab(aId);
    expect(get().split).toEqual({ a: cId, b: aId });
    expect(get().activeTabId).toBe(aId);
    expect(get().root).toBe("/a");
  });

  it("closeTab the ACTIVE pair member dissolves the split + promotes the survivor", () => {
    get().openProject("/a");
    get().openProject("/b");
    const aId = tabIdAt(1);
    const bId = tabIdAt(2); // active

    get().splitActiveWith(aId); // split = { a: b, b: a }, active b
    expect(get().split).toEqual({ a: bId, b: aId });

    get().closeTab(bId); // close the active member -> promote the survivor a
    const s = get();
    expect(s.split).toBeNull();
    expect(s.activeTabId).toBe(aId);
    expect(s.root).toBe("/a");
    expect(s.tabState[bId]).toBeUndefined();
  });

  it("closeTab a NON-active pair member dissolves the split, active unchanged", () => {
    get().openProject("/a");
    get().openProject("/b");
    get().openProject("/c"); // active /c
    const aId = tabIdAt(1);
    const cId = tabIdAt(3);

    get().splitActiveWith(aId); // split = { a: c, b: a }, active c
    expect(get().split).toEqual({ a: cId, b: aId });

    get().closeTab(aId); // a is the non-active (secondary) member
    const s = get();
    expect(s.split).toBeNull();
    expect(s.activeTabId).toBe(cId); // active unchanged
    expect(s.tabState[aId]).toBeUndefined();
  });

  // Regression: splitting/adding a terminal in the SECONDARY pane must hit that
  // pane, not the focused one. addTerminal/setActiveTerminal/setSplit took the
  // active tab, so the in-pane terminal controls of a non-active split pane
  // operated on the wrong project (the user's "split the 2nd terminal bugs out").
  it("terminal actions target the passed pane's tab, not the active one", () => {
    get().openProject("/a");
    get().openProject("/b"); // active /b
    const aId = tabIdAt(1);
    const bId = tabIdAt(2);

    get().splitActiveWith(aId); // split = { a: b (active/primary), b: a (secondary) }
    expect(get().split).toEqual({ a: bId, b: aId });
    expect(get().activeTabId).toBe(bId); // the secondary (aId) is NOT active

    // addTerminal(secondary) lands in the secondary's slice; the active tab is
    // untouched (pre-fix this spawned into bId, the focused pane).
    const term1 = get().addTerminal(aId);
    expect(tt(aId).terminals.map((t) => t.id)).toContain(term1);
    expect(tt(aId).activeTerminalId).toBe(term1);
    expect(tt(bId).terminals).toHaveLength(0);

    // The terminal-split flow (add second, keep first active, show second in the
    // split slot), all scoped to the secondary -- mirrors TerminalTabs.splitActive.
    const term2 = get().addTerminal(aId);
    get().setActiveTerminal(term1, aId);
    get().setSplit(term2, aId);
    expect(tt(aId).activeTerminalId).toBe(term1);
    expect(tt(aId).splitTerminalId).toBe(term2);
    // Focused pane b never grew a terminal or a split.
    expect(tt(bId).terminals).toHaveLength(0);
    expect(tt(bId).splitTerminalId).toBeNull();
  });
});

describe("per-project setters: explicit tabId vs active", () => {
  it("a setter with an explicit non-active tabId updates that tab only (no mirror)", () => {
    get().openProject("/a");
    const aId = tabIdAt(1);
    get().openProject("/b");
    const bId = tabIdAt(2); // active

    // target the BACKGROUND tab a explicitly
    get().setSelected("/a/file.ts", null, aId);
    const s = get();

    // tabState[a] updated...
    expect(s.tabState[aId]?.selectedFile).toBe("/a/file.ts");
    // ...but the top-level mirror (tracking active b) is NOT touched
    expect(s.selectedFile).toBeNull();
    expect(s.root).toBe("/b");
    // b's own state untouched
    expect(s.tabState[bId]?.selectedFile).toBeNull();
  });

  it("a setter with no tabId updates the active tab AND the mirror", () => {
    get().openProject("/a");
    const aId = tabIdAt(1); // active

    get().setSelected("/a/file.ts", null);
    const s = get();

    expect(s.tabState[aId]?.selectedFile).toBe("/a/file.ts");
    expect(s.selectedFile).toBe("/a/file.ts"); // mirror synced
  });

  it("setGitStatus / setDbView with an explicit tabId stay off the mirror", () => {
    get().openProject("/a");
    const aId = tabIdAt(1);
    get().openProject("/b"); // active b

    get().setGitStatus(null, aId);
    get().setDbView({ kind: "secret", id: "x", schema: "s", table: "t" }, aId);
    const s = get();

    expect(s.tabState[aId]?.dbView).toEqual({
      kind: "secret",
      id: "x",
      schema: "s",
      table: "t",
    });
    // active mirror (b) unaffected by the explicit-tab writes
    expect(s.dbView).toBeNull();
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

describe("applyPtyStatus + tabGlow", () => {
  // Helper: add a terminal to the ACTIVE tab and give it a ptyId, returning
  // both ids. (addTerminal targets the active tab and returns the renderer uid;
  // setTerminalPty routes by uid to the owning tab.)
  const addTermWithPty = (ptyId: string): { termId: string; ptyId: string } => {
    const termId = get().addTerminal();
    get().setTerminalPty(termId, ptyId);
    return { termId, ptyId };
  };

  it("working=true makes the tab derive-working with no glow", () => {
    const aId = tabIdAt(0); // initial blank tab, active
    addTermWithPty("pty-a");

    get().applyPtyStatus("pty-a", true);
    const s = get();

    expect(s.sessionWorking["pty-a"]).toBe(true);
    // derived tab-working: the tab has a terminal whose ptyId is working
    const working = tt(aId).terminals.some(
      (t) => t.ptyId !== null && s.sessionWorking[t.ptyId] === true,
    );
    expect(working).toBe(true);
    // a working tab never glows
    expect(s.tabGlow[aId]).toBeUndefined();
  });

  it("working->done in a BACKGROUND tab sets the glow", () => {
    // terminal lands in the initial tab, then open /b so the initial tab is
    // backgrounded.
    const aId = tabIdAt(0);
    addTermWithPty("pty-a");
    get().openProject("/b");
    expect(get().activeTabId).not.toBe(aId);

    get().applyPtyStatus("pty-a", true); // working
    expect(get().tabGlow[aId]).toBeUndefined();

    get().applyPtyStatus("pty-a", false); // finished while backgrounded
    expect(get().tabGlow[aId]).toBe(true);
  });

  it("working->done in the ACTIVE tab does NOT glow", () => {
    const aId = tabIdAt(0); // active throughout
    addTermWithPty("pty-a");

    get().applyPtyStatus("pty-a", true);
    get().applyPtyStatus("pty-a", false);

    expect(get().activeTabId).toBe(aId);
    expect(get().tabGlow[aId]).toBeUndefined();
  });

  it("switchTab to a glowing tab clears its glow", () => {
    const aId = tabIdAt(0);
    addTermWithPty("pty-a");
    get().openProject("/b"); // background aId

    get().applyPtyStatus("pty-a", true);
    get().applyPtyStatus("pty-a", false);
    expect(get().tabGlow[aId]).toBe(true);

    get().switchTab(aId); // activating dismisses the glow
    expect(get().tabGlow[aId]).toBeUndefined();
    expect(get().activeTabId).toBe(aId);
  });

  it("a backgrounded glowing tab that resumes working clears its glow", () => {
    const aId = tabIdAt(0);
    addTermWithPty("pty-a");
    get().openProject("/b"); // background aId

    get().applyPtyStatus("pty-a", true);
    get().applyPtyStatus("pty-a", false);
    expect(get().tabGlow[aId]).toBe(true);

    // resumes working -> it is busy, not finished-waiting -> glow cleared
    get().applyPtyStatus("pty-a", true);
    expect(get().tabGlow[aId]).toBeUndefined();
  });

  it("a pty id owned by no tab only records sessionWorking", () => {
    get().applyPtyStatus("pty-orphan", true);
    expect(get().sessionWorking["pty-orphan"]).toBe(true);
    expect(get().tabGlow).toEqual({});
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

describe("showRunningProcessNotice", () => {
  it("defaults true and setShowRunningProcessNotice toggles the field", () => {
    expect(get().showRunningProcessNotice).toBe(true);

    get().setShowRunningProcessNotice(false);
    expect(get().showRunningProcessNotice).toBe(false);

    get().setShowRunningProcessNotice(true);
    expect(get().showRunningProcessNotice).toBe(true);
  });

  it("is independent of the runningNotice field", () => {
    // Disabling the pref does not touch a set notice, and clearing the notice
    // does not touch the pref -- they are separate concerns (the banner gates on
    // both, but the store fields do not interact).
    get().setRunningNotice({ terminalId: "term-1" });
    get().setShowRunningProcessNotice(false);
    expect(get().runningNotice).toEqual({ terminalId: "term-1" });

    get().setShowRunningProcessNotice(true);
    get().setRunningNotice(null);
    expect(get().showRunningProcessNotice).toBe(true);
  });
});
