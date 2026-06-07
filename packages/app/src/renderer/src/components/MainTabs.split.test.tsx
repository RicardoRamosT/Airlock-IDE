// @vitest-environment jsdom
//
// MainTabs interaction guards for the unified-split tab bar:
//  - "+" (new terminal) full-screens the new terminal (collapses any split) --
//    the chosen behavior; the toolbar split button is the "beside" action.
//  - the toolbar "split with a new terminal" yields [primary | new terminal]
//    without collapsing, even when the primary is a terminal.
//  - a newly created tab is appended at the FAR-RIGHT end of the tab order
//    (mainTabOrder), not grouped by type (bug: a new terminal landed mid-bar,
//    left of open files).

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "../store";
import { MainTabs } from "./MainTabs";

// Snapshot the pristine store (one blank tab, no terminals) and restore it
// before each test so the shared singleton does not leak state across tests.
const initialState = useApp.getState();

beforeEach(() => {
  // "+" -> newTerminal touches the store only; the no-op Proxy covers the rest
  // (e.g. ptyKill on the kill buttons, which we never click here).
  window.airlock = new Proxy(
    {},
    { get: () => () => Promise.resolve(undefined) },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});

afterEach(() => cleanup());

const get = () => useApp.getState();

it("'+' on a [terminal | file] split solos the new terminal, split preserved", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");

  // Build [terminal (primary) | file (secondary)].
  const t1 = get().addTerminal(tabId);
  get().openFile("LAYOUT.md", { content: "# x", truncated: false }, tabId);
  get().setMainPrimary("terminal", tabId);
  get().splitWith({ kind: "file", path: "LAYOUT.md" }, tabId);
  expect(get().tabState[tabId]?.mainSecondary).toEqual({
    kind: "file",
    path: "LAYOUT.md",
  });

  const { getByTitle } = render(<MainTabs tabId={tabId} />);
  fireEvent.click(getByTitle("New terminal"));

  // The split is PRESERVED; the new terminal is shown solo on top of it, and the
  // split's primary terminal is restored (not hijacked by the new one).
  const st = get().tabState[tabId];
  expect(st?.mainSecondary).toEqual({ kind: "file", path: "LAYOUT.md" });
  expect(st?.mainSolo?.kind).toBe("terminal");
  expect(st?.mainSolo).not.toEqual({ kind: "terminal", id: t1 });
  const tt = get().tabTerminals[tabId];
  expect(tt?.terminals.length).toBe(2);
  expect(tt?.activeTerminalId).toBe(t1);
});

it("clicking a split-member tab returns to the split (drops the solo)", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  // Build a [t1 | t2] terminal split, then solo a third terminal (as '+' does).
  const t1 = get().addTerminal(tabId);
  const t2 = get().addTerminal(tabId);
  get().setActiveTerminal(t1, tabId);
  get().setMainPrimary("terminal", tabId);
  get().splitWith({ kind: "terminal", id: t2 }, tabId); // [t1 | t2]
  const t3 = get().addTerminal(tabId);
  get().setActiveTerminal(t1, tabId); // keep t1 as the split's primary
  get().setSolo({ kind: "terminal", id: t3 }, tabId); // soloing t3
  expect(get().tabState[tabId]?.mainSolo).toEqual({ kind: "terminal", id: t3 });

  // Tabs render in mainTabOrder [t1, t2, t3]; clicking t1 (a split member) returns.
  const { getAllByTitle } = render(<MainTabs tabId={tabId} />);
  const t1Tab = getAllByTitle("zsh")[0];
  if (!t1Tab) throw new Error("no terminal tab");
  fireEvent.click(t1Tab);

  const st = get().tabState[tabId];
  expect(st?.mainSolo).toBeNull(); // back to the split
  expect(st?.mainSecondary).toEqual({ kind: "terminal", id: t2 });
});

it("toolbar split on a single file pane yields [file | new terminal]", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  get().openFile("a.ts", { content: "x", truncated: false }, tabId);
  expect(get().tabState[tabId]?.mainSecondary).toBeNull();

  const { getByTitle } = render(<MainTabs tabId={tabId} />);
  fireEvent.click(getByTitle("Split with a new terminal"));

  const st = get().tabState[tabId];
  expect(st?.mainPrimary).toBe("editor"); // file stays primary
  expect(st?.selectedFile).toBe("a.ts");
  expect(st?.mainSecondary?.kind).toBe("terminal"); // new terminal beside it
});

it("toolbar toggles: Unsplit while showing the split, Split otherwise (no 2nd-split leak)", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  const t1 = get().addTerminal(tabId);
  const t2 = get().addTerminal(tabId);
  get().setActiveTerminal(t1, tabId);
  get().setMainPrimary("terminal", tabId);
  get().splitWith({ kind: "terminal", id: t2 }, tabId); // showing split [t1 | t2]

  const { queryByTitle, rerender } = render(<MainTabs tabId={tabId} />);
  // Showing the 2-pane split -> only Unsplit; the Split button is gone, so you
  // cannot "2nd-split" into an overwrite/leak.
  expect(queryByTitle("Single pane (unsplit)")).not.toBeNull();
  expect(queryByTitle("Split with a new terminal")).toBeNull();

  // Solo a 3rd terminal (single on screen) -> the Split button returns.
  const t3 = get().addTerminal(tabId);
  get().setActiveTerminal(t1, tabId);
  get().setSolo({ kind: "terminal", id: t3 }, tabId);
  rerender(<MainTabs tabId={tabId} />);
  expect(queryByTitle("Split with a new terminal")).not.toBeNull();
  expect(queryByTitle("Single pane (unsplit)")).toBeNull();
});

it("a new terminal tab is appended at the far-right end, after files", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  const t1 = get().addTerminal(tabId);
  get().openFile("a.ts", { content: "x", truncated: false }, tabId);
  expect(get().tabState[tabId]?.mainTabOrder).toEqual([
    { kind: "terminal", id: t1 },
    { kind: "file", path: "a.ts" },
  ]);

  const { getByTitle } = render(<MainTabs tabId={tabId} />);
  fireEvent.click(getByTitle("New terminal"));

  // The new terminal is LAST -- after the file -- not grouped next to t1.
  const order = get().tabState[tabId]?.mainTabOrder ?? [];
  const last = order[order.length - 1];
  expect(last?.kind).toBe("terminal");
  expect(last).not.toEqual({ kind: "terminal", id: t1 });
  const fileIdx = order.findIndex(
    (it) => it.kind === "file" && it.path === "a.ts",
  );
  expect(order.length - 1).toBeGreaterThan(fileIdx);
});
