// @vitest-environment jsdom
//
// Regression guard for the "new terminal collapses my split" bug. With a
// [terminal | file] split (terminal PRIMARY, file SECONDARY), clicking "+"
// (new terminal) used to call splitWith(newId) unconditionally; since the new
// terminal was also the active one, the primary pane (active terminal) and the
// secondary (newId) resolved to the SAME terminal and ProjectTerminals
// collapsed to a single pane -- the file disappeared. The fix: when the primary
// is already a terminal, the new (now-active) terminal just fills that slot and
// the secondary file is left untouched.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "../store";
import { MainTabs } from "./MainTabs";

beforeEach(() => {
  // "+" -> newTerminal touches the store only; the no-op Proxy covers the rest
  // (e.g. ptyKill on the kill buttons, which we never click here).
  window.airlock = new Proxy(
    {},
    { get: () => () => Promise.resolve(undefined) },
  ) as unknown as typeof window.airlock;
});

afterEach(() => cleanup());

const get = () => useApp.getState();

it("'+' on a [terminal | file] split keeps the file pane (no collapse)", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");

  // Build [terminal (primary) | file (secondary)]: a terminal active as the
  // primary, with a file occupying the secondary pane.
  const t1 = get().addTerminal(tabId);
  get().openFile("LAYOUT.md", { content: "# x", truncated: false }, tabId);
  get().setMainPrimary("terminal", tabId); // primary = terminal t1
  get().splitWith({ kind: "file", path: "LAYOUT.md" }, tabId); // secondary = file
  expect(get().tabState[tabId]?.mainPrimary).toBe("terminal");
  expect(get().tabState[tabId]?.mainSecondary).toEqual({
    kind: "file",
    path: "LAYOUT.md",
  });

  const { getByTitle } = render(<MainTabs tabId={tabId} />);
  fireEvent.click(getByTitle("New terminal"));

  // The new terminal fills the (terminal) primary slot; the file secondary must
  // survive -- still split, still [terminal | file], just a fresh terminal.
  const st = get().tabState[tabId];
  expect(st?.mainPrimary).toBe("terminal");
  expect(st?.mainSecondary).toEqual({ kind: "file", path: "LAYOUT.md" });
  const tt = get().tabTerminals[tabId];
  expect(tt?.terminals.length).toBe(2);
  expect(tt?.activeTerminalId).not.toBe(t1); // the new terminal is now active
});

it("toolbar split on a single file pane yields [file | new terminal]", () => {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  get().openFile("a.ts", { content: "x", truncated: false }, tabId); // single file pane
  expect(get().tabState[tabId]?.mainSecondary).toBeNull();

  const { getByTitle } = render(<MainTabs tabId={tabId} />);
  fireEvent.click(getByTitle("Split with a new terminal"));

  const st = get().tabState[tabId];
  expect(st?.mainPrimary).toBe("editor"); // file stays primary
  expect(st?.selectedFile).toBe("a.ts");
  expect(st?.mainSecondary?.kind).toBe("terminal"); // new terminal beside it
});
