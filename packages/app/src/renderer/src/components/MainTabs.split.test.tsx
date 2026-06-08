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

it("'+' focuses a new terminal alone; an existing split is preserved", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  const t1 = get().addTerminal(tabId);
  get().openFile(
    "LAYOUT.md",
    { content: "# x", truncated: false, binary: false, size: 1 },
    tabId,
  );
  get().splitItems(
    { kind: "terminal", id: t1 },
    { kind: "file", path: "LAYOUT.md" },
    tabId,
  ); // [t1 | LAYOUT.md]
  expect(get().tabState[tabId]?.mainSecondary).toEqual({
    kind: "file",
    path: "LAYOUT.md",
  });

  const { getByTitle } = render(<MainTabs tabId={tabId} />);
  fireEvent.click(getByTitle("New terminal"));

  // The new terminal is focused ALONE; the [t1 | LAYOUT.md] split is preserved.
  const st = get().tabState[tabId];
  expect(st?.mainSecondary).toBeNull();
  expect(st?.current?.kind).toBe("terminal");
  expect(st?.current).not.toEqual({ kind: "terminal", id: t1 });
  expect(st?.splits).toEqual([
    [
      { kind: "terminal", id: t1 },
      { kind: "file", path: "LAYOUT.md" },
    ],
  ]);
});

it("clicking a split-member tab shows that split", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  const t1 = get().addTerminal(tabId);
  const t2 = get().addTerminal(tabId);
  get().splitItems(
    { kind: "terminal", id: t1 },
    { kind: "terminal", id: t2 },
    tabId,
  ); // [t1 | t2]
  get().addTerminal(tabId); // focuses a 3rd terminal alone; [t1|t2] preserved
  expect(get().tabState[tabId]?.mainSecondary).toBeNull();

  // Tabs render in order [t1, t2, t3]; clicking t1 (a split member) shows [t1|t2].
  const { getAllByTitle } = render(<MainTabs tabId={tabId} />);
  const t1Tab = getAllByTitle("zsh")[0];
  if (!t1Tab) throw new Error("no terminal tab");
  fireEvent.click(t1Tab);

  expect(get().tabState[tabId]?.mainSecondary).toEqual({
    kind: "terminal",
    id: t2,
  });
});

it("toolbar split on a single file pane yields [file | new terminal]", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  get().openFile(
    "a.ts",
    { content: "x", truncated: false, binary: false, size: 1 },
    tabId,
  );
  expect(get().tabState[tabId]?.mainSecondary).toBeNull();

  const { getByTitle } = render(<MainTabs tabId={tabId} />);
  fireEvent.click(getByTitle("Split with a new terminal"));

  const st = get().tabState[tabId];
  expect(st?.mainPrimary).toBe("editor"); // file stays primary (left)
  expect(st?.selectedFile).toBe("a.ts");
  expect(st?.mainSecondary?.kind).toBe("terminal"); // new terminal beside it
});

it("toolbar toggles: Unsplit while showing a split, Split otherwise", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  const t1 = get().addTerminal(tabId);
  const t2 = get().addTerminal(tabId);
  get().splitItems(
    { kind: "terminal", id: t1 },
    { kind: "terminal", id: t2 },
    tabId,
  ); // showing [t1 | t2]

  const { queryByTitle, rerender } = render(<MainTabs tabId={tabId} />);
  // Showing the 2-pane split -> only Unsplit (it is 2-pane max; no "2nd split").
  expect(queryByTitle("Single pane (unsplit)")).not.toBeNull();
  expect(queryByTitle("Split with a new terminal")).toBeNull();

  // Focus a 3rd terminal alone -> the Split button returns.
  get().addTerminal(tabId);
  rerender(<MainTabs tabId={tabId} />);
  expect(queryByTitle("Split with a new terminal")).not.toBeNull();
  expect(queryByTitle("Single pane (unsplit)")).toBeNull();
});

it("a new terminal tab is appended at the far-right end, after files", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  const t1 = get().addTerminal(tabId);
  get().openFile(
    "a.ts",
    { content: "x", truncated: false, binary: false, size: 1 },
    tabId,
  );
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
