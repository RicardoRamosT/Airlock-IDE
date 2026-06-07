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

it("'+' full-screens a new terminal, collapsing a [terminal | file] split", () => {
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

  // Collapsed to a single full-screen terminal: no secondary, the new terminal
  // active and primary.
  const st = get().tabState[tabId];
  expect(st?.mainPrimary).toBe("terminal");
  expect(st?.mainSecondary).toBeNull();
  const tt = get().tabTerminals[tabId];
  expect(tt?.terminals.length).toBe(2);
  expect(tt?.activeTerminalId).not.toBe(t1);
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
