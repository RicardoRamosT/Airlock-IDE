import { beforeEach, describe, expect, it } from "vitest";
import { useApp } from "../store";
import { openPickedFolder } from "./openFolder";

// Pristine store state (incl. all action fns) captured ONCE, restored before
// every test via setState(initialState, true). Mirrors store.test.ts.
const initialState = useApp.getState();

// The helper reads window.airlock.ptyIsBusy; the store's setRoot/switch paths
// also reach for workspaceSetActive / workspaceClose. The test env is
// environment:"node" -> no window global, so define one. ptyIsBusy is toggleable
// per test via the `busy` flag.
let busy = false;

beforeEach(() => {
  busy = false;
  (globalThis as { window?: unknown }).window = {
    airlock: {
      ptyIsBusy: (_id: string) => Promise.resolve(busy),
      workspaceSetActive: (_p: string) => Promise.resolve(),
      workspaceClose: () => Promise.resolve(),
    },
  };
  useApp.setState(initialState, true);
});

const get = () => useApp.getState();

const tabIdAt = (i: number): string => {
  const tab = get().tabs[i];
  if (!tab) throw new Error(`no tab at index ${i}`);
  return tab.id;
};

describe("openPickedFolder", () => {
  it("delegates to a NEW tab (no notice) when the active tab already has a project", async () => {
    // Fill the initial blank tab so the active tab HAS a project.
    get().setRoot("/a");
    expect(get().tabs).toHaveLength(1);
    expect(get().root).toBe("/a");

    // ptyIsBusy must NOT decide anything here -- even busy, a project-active tab
    // takes the normal new-tab route.
    busy = true;

    await openPickedFolder("/b");
    const s = get();

    // appended a new tab (tabs mode), made it active; no running notice flagged
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs.map((t) => t.root)).toEqual(["/a", "/b"]);
    expect(s.activeTabId).toBe(tabIdAt(1));
    expect(s.root).toBe("/b");
    expect(s.runningNotice).toBeNull();
  });

  it("blank tab + IDLE terminal: replaces with one folder-rooted terminal, no notice", async () => {
    const blankId = tabIdAt(0); // initial blank tab, active

    // Give the blank tab a terminal WITH a ptyId so prevPty is non-null and
    // ptyIsBusy is actually consulted.
    const t1 = get().addTerminal();
    get().setTerminalPty(t1, "pty-1");
    expect(get().tabTerminals[blankId]?.terminals.map((t) => t.id)).toEqual([
      t1,
    ]);

    busy = false; // idle

    await openPickedFolder("/a");
    const s = get();

    // folder attached in place (same tab id), root set
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.id).toBe(blankId);
    expect(s.root).toBe("/a");

    // exactly ONE terminal: the fresh folder-rooted one; the old idle one dropped
    const terms = s.tabTerminals[blankId]?.terminals ?? [];
    expect(terms).toHaveLength(1);
    expect(terms[0]?.id).not.toBe(t1); // the old idle terminal was removed
    expect(s.tabTerminals[blankId]?.activeTerminalId).toBe(terms[0]?.id);

    // no notice in the idle case
    expect(s.runningNotice).toBeNull();
  });

  it("blank tab + BUSY terminal: keeps the old terminal AND adds the new one, flags the notice", async () => {
    const blankId = tabIdAt(0);

    const t1 = get().addTerminal();
    get().setTerminalPty(t1, "pty-1");

    busy = true; // a live `claude` etc.

    await openPickedFolder("/a");
    const s = get();

    // folder attached in place, root set
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.id).toBe(blankId);
    expect(s.root).toBe("/a");

    // BOTH terminals present: the kept busy one + the fresh folder-rooted one
    const terms = s.tabTerminals[blankId]?.terminals ?? [];
    expect(terms).toHaveLength(2);
    const ids = terms.map((t) => t.id);
    expect(ids).toContain(t1); // the busy terminal is NOT killed

    // the new terminal is active and is the one the notice points at
    const newId = ids.find((id) => id !== t1);
    expect(newId).toBeDefined();
    expect(s.tabTerminals[blankId]?.activeTerminalId).toBe(newId);
    expect(s.runningNotice).toEqual({ terminalId: newId });
  });
});
