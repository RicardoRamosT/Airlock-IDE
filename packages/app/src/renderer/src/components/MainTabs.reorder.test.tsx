// @vitest-environment jsdom
//
// MainTabs drag-to-reorder: content tabs (terminals/files) reorder within one
// sequence via mainTabOrder. (DB-table tabs reorder via dbTabs in their own
// group; the two groups stay separate.)

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { MainTabs } from "./MainTabs";

const initialState = useApp.getState();

beforeEach(() => {
  window.airlock = new Proxy(
    {},
    { get: () => () => Promise.resolve(undefined) },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const get = () => useApp.getState();
// jsdom rects are all zero; stub a horizontal rect on every element so a chosen
// clientX lands in a known half of the drop target (midpoint = left + width/2).
function stubRect(left: number, width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 24,
    height: 24,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}
// fireEvent's drag events drop clientX in jsdom (no DragEvent ctor); dispatch a
// real MouseEvent (which carries clientX) with a stub dataTransfer attached.
function fireDrag(type: string, el: Element, clientX = 0) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(ev, "dataTransfer", {
    value: {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      getData: () => "",
      effectAllowed: "",
    },
  });
  fireEvent(el, ev);
}
const tabDiv = (el: HTMLElement): Element => {
  const d = el.closest(".main-tab");
  if (!d) throw new Error("no .main-tab ancestor");
  return d;
};
// The label button is the drag SOURCE (the container is the drop TARGET).
const labelBtn = (el: HTMLElement): Element => {
  const b = el.closest("button");
  if (!b) throw new Error("no label button");
  return b;
};

it("dragging a terminal tab before another reorders mainTabOrder", () => {
  const tabId = get().tabs[0]?.id as string;
  const a = get().addTerminal(tabId);
  const b = get().addTerminal(tabId);
  get().setTerminalTitle(a, "alpha", true);
  get().setTerminalTitle(b, "beta", true);
  expect(get().tabState[tabId]?.mainTabOrder).toEqual([
    { kind: "terminal", id: a },
    { kind: "terminal", id: b },
  ]);

  const { getByText } = render(<MainTabs tabId={tabId} />);
  const aTab = tabDiv(getByText("alpha"));
  stubRect(100, 40); // midpoint 120
  fireDrag("dragstart", labelBtn(getByText("beta"))); // source = label button
  fireDrag("dragover", aTab, 105); // left half -> before
  fireDrag("drop", aTab, 105);

  expect(get().tabState[tabId]?.mainTabOrder).toEqual([
    { kind: "terminal", id: b },
    { kind: "terminal", id: a },
  ]);
});

it("dropping on the right half lands the tab after the target", () => {
  const tabId = get().tabs[0]?.id as string;
  const a = get().addTerminal(tabId);
  const b = get().addTerminal(tabId);
  const c = get().addTerminal(tabId);
  get().setTerminalTitle(a, "alpha", true);
  get().setTerminalTitle(b, "beta", true);
  get().setTerminalTitle(c, "gamma", true);

  const { getByText } = render(<MainTabs tabId={tabId} />);
  const cTab = tabDiv(getByText("gamma"));
  stubRect(100, 40); // midpoint 120
  fireDrag("dragstart", labelBtn(getByText("alpha"))); // source = label button
  fireDrag("dragover", cTab, 130); // right half -> after
  fireDrag("drop", cTab, 130);

  // alpha moves to the end (after gamma).
  expect(get().tabState[tabId]?.mainTabOrder).toEqual([
    { kind: "terminal", id: b },
    { kind: "terminal", id: c },
    { kind: "terminal", id: a },
  ]);
});
