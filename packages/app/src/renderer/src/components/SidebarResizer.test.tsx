// @vitest-environment jsdom
//
// Proves the resize wiring works end to end: a mousedown on the handle + a
// document mousemove + mouseup commits the new width to the store and prefs;
// dragging past the collapse threshold hides the sidebar; double-click and the
// Arrow keys also commit. (The hit-area / cursor is CSS, not covered here.)

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { SidebarResizer } from "./SidebarResizer";

const initialState = useApp.getState();
let prefsSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useApp.setState(initialState, true);
  useApp.setState({ sidebarWidth: 230, sidebarPosition: "left" });
  prefsSet = vi.fn(() => Promise.resolve());
  window.airlock = new Proxy(
    {},
    { get: (_t, prop: string) => (prop === "prefsSet" ? prefsSet : () => {}) },
  ) as unknown as typeof window.airlock;
});

afterEach(cleanup);

// The component does closest(".workspace") to find the element it mutates live,
// so it must render inside one.
function renderInWorkspace() {
  return render(
    <div className="workspace">
      <SidebarResizer />
    </div>,
  );
}

const handle = () => screen.getByRole("separator");

it("renders a focusable separator handle", () => {
  renderInWorkspace();
  const h = handle();
  expect(h.getAttribute("tabindex")).toBe("0");
  expect(h.getAttribute("aria-valuenow")).toBe("230");
});

it("drag right (left dock) widens the sidebar and persists it", () => {
  renderInWorkspace();
  fireEvent.mouseDown(handle(), { clientX: 274 });
  fireEvent.mouseMove(document, { clientX: 334 }); // +60
  fireEvent.mouseUp(document);
  expect(useApp.getState().sidebarWidth).toBe(290);
  expect(prefsSet).toHaveBeenCalledWith({ sidebarWidth: 290 });
  expect(useApp.getState().sidebarVisible).toBe(true);
});

it("drag past the collapse threshold hides the sidebar (width preserved)", () => {
  renderInWorkspace();
  fireEvent.mouseDown(handle(), { clientX: 274 });
  fireEvent.mouseMove(document, { clientX: 74 }); // -200 -> below collapse gate
  fireEvent.mouseUp(document);
  expect(useApp.getState().sidebarVisible).toBe(false);
  expect(useApp.getState().sidebarWidth).toBe(230); // unchanged, for re-open
  expect(prefsSet).toHaveBeenCalledWith({ sidebarVisible: false });
});

it("double-click resets to the default width", () => {
  useApp.setState({ sidebarWidth: 400 });
  renderInWorkspace();
  fireEvent.doubleClick(handle());
  expect(useApp.getState().sidebarWidth).toBe(230);
  expect(prefsSet).toHaveBeenCalledWith({ sidebarWidth: 230 });
});

it("ArrowRight nudges the width wider and persists", () => {
  renderInWorkspace();
  fireEvent.keyDown(handle(), { key: "ArrowRight" });
  expect(useApp.getState().sidebarWidth).toBe(246); // +16 step
  expect(prefsSet).toHaveBeenCalledWith({ sidebarWidth: 246 });
});
