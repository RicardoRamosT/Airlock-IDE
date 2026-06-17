// @vitest-environment jsdom
//
// Project-strip drag-to-reorder: every entry -- project tabs AND the IDE
// page-tabs (Settings/Usage/Overview) -- reorders within one row via stripOrder.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { ProjectTabs } from "./ProjectTabs";

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
    value: { setData: vi.fn(), getData: () => "", effectAllowed: "" },
  });
  fireEvent(el, ev);
}
const projTab = (el: HTMLElement): Element => {
  const d = el.closest(".project-tab");
  if (!d) throw new Error("no .project-tab ancestor");
  return d;
};
// The label button is the drag SOURCE (the container is the drop TARGET).
const labelBtn = (el: HTMLElement): Element => {
  const b = el.closest("button");
  if (!b) throw new Error("no label button");
  return b;
};

function seedTabs(): void {
  useApp.setState({
    openProjectsAsTabs: true,
    tabs: [
      { id: "t1", root: "/Users/x/alpha" },
      { id: "t2", root: "/Users/x/beta" },
      { id: "t3", root: "/Users/x/gamma" },
    ],
    activeTabId: "t1",
    stripOrder: [],
  });
}

it("dragging a project tab to the front reorders stripOrder", () => {
  seedTabs();
  const { getByText } = render(<ProjectTabs />);
  const alpha = projTab(getByText("alpha"));
  stubRect(100, 40); // midpoint 120
  fireDrag("dragstart", labelBtn(getByText("gamma"))); // source = label button
  fireDrag("dragover", alpha, 105); // before alpha
  fireDrag("drop", alpha, 105);

  expect(get().stripOrder).toEqual(["t3", "t1", "t2"]);
});

it("page-tabs are draggable among project tabs (everything draggable)", () => {
  seedTabs();
  useApp.setState({ settingsTabOpen: true, appPage: "settings" });
  const { getByText } = render(<ProjectTabs />);
  const alpha = projTab(getByText("alpha"));
  stubRect(100, 40);
  fireDrag("dragstart", labelBtn(getByText("Settings"))); // source = label button
  fireDrag("dragover", alpha, 105); // before alpha
  fireDrag("drop", alpha, 105);

  expect(get().stripOrder).toEqual(["page:settings", "t1", "t2", "t3"]);
});
