// @vitest-environment jsdom
//
// Project tab rename (display-only): store semantics here, tab-strip UI in the
// tests Task 2 appends below. The rename NEVER touches the folder on disk --
// there is no IPC anywhere in this path.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "../store";
import { ProjectTabs } from "./ProjectTabs";

const initialState = useApp.getState();

afterEach(() => cleanup());

beforeEach(() => {
  // Minimal airlock stub: store actions like closeTab fire guarded,
  // fire-and-forget syncs; the Proxy answers anything with a resolved Promise.
  window.airlock = new Proxy(
    {},
    {
      get: () => () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});

const get = () => useApp.getState();

// Seed two project tabs directly (the strip needs >1 tab or tabs-mode to even
// render; store-level tests just need the ids to exist).
function seedTabs(): void {
  useApp.setState({
    openProjectsAsTabs: true,
    tabs: [
      { id: "t1", root: "/Users/x/airlock" },
      { id: "t2", root: "/Users/x/other" },
    ],
    activeTabId: "t1",
  });
}

it("renameTab stores a trimmed custom label", () => {
  seedTabs();
  get().renameTab("t1", "  My Fork  ");
  expect(get().tabRenames.t1).toBe("My Fork");
});

it("renameTab with an empty/whitespace name clears the entry (reset)", () => {
  seedTabs();
  get().renameTab("t1", "My Fork");
  get().renameTab("t1", "   ");
  expect(get().tabRenames.t1).toBeUndefined();
});

it("renameTab no-ops for an unknown tab id", () => {
  seedTabs();
  get().renameTab("ghost", "Boo");
  expect(get().tabRenames).toEqual({});
});

it("closeTab drops the closed tab's rename entry", () => {
  seedTabs();
  get().renameTab("t2", "Scratch");
  get().closeTab("t2");
  expect(get().tabRenames.t2).toBeUndefined();
});

it("closing the LAST tab resets the rename map", () => {
  useApp.setState({
    openProjectsAsTabs: true,
    tabs: [{ id: "t1", root: "/Users/x/airlock" }],
    activeTabId: "t1",
  });
  get().renameTab("t1", "Solo");
  get().closeTab("t1");
  expect(get().tabRenames).toEqual({});
});

const renderStrip = () => render(<ProjectTabs />);

it("right-click -> Rename tab… swaps the label for a pre-filled input", () => {
  seedTabs();
  const { getByText, container } = renderStrip();

  fireEvent.contextMenu(getByText("airlock"));
  fireEvent.click(getByText("Rename tab…"));

  const input = container.querySelector(
    "input.tab-rename-input",
  ) as HTMLInputElement;
  expect(input).toBeTruthy();
  expect(input.value).toBe("airlock");
});

it("typing a new name and submitting renames the tab label", () => {
  seedTabs();
  const { getByText, queryByText, container } = renderStrip();

  fireEvent.doubleClick(getByText("airlock"));
  const input = container.querySelector(
    "input.tab-rename-input",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "My Fork" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);

  expect(getByText("My Fork")).toBeTruthy();
  expect(queryByText("airlock")).toBeNull();
  expect(useApp.getState().tabRenames.t1).toBe("My Fork");
});

it("blur commits the edit", () => {
  seedTabs();
  const { getByText, container } = renderStrip();

  fireEvent.doubleClick(getByText("airlock"));
  const input = container.querySelector(
    "input.tab-rename-input",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Blurred" } });
  fireEvent.blur(input);

  expect(getByText("Blurred")).toBeTruthy();
  expect(useApp.getState().tabRenames.t1).toBe("Blurred");
});

it("Escape cancels without renaming", () => {
  seedTabs();
  const { getByText, container } = renderStrip();

  fireEvent.doubleClick(getByText("airlock"));
  const input = container.querySelector(
    "input.tab-rename-input",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Nope" } });
  fireEvent.keyDown(input, { key: "Escape" });

  expect(getByText("airlock")).toBeTruthy();
  expect(useApp.getState().tabRenames).toEqual({});
});

it("committing an empty name resets to the basename label", () => {
  seedTabs();
  useApp.getState().renameTab("t1", "My Fork");
  const { getByText, container } = renderStrip();

  fireEvent.doubleClick(getByText("My Fork"));
  const input = container.querySelector(
    "input.tab-rename-input",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);

  expect(getByText("airlock")).toBeTruthy();
  expect(useApp.getState().tabRenames.t1).toBeUndefined();
});

it("the split-pair label resolves member renames", () => {
  seedTabs();
  useApp.setState({ split: { a: "t1", b: "t2" } });
  useApp.getState().renameTab("t1", "Custom");
  const { getByText } = renderStrip();

  // The combined pair entry renders both member labels.
  expect(getByText(/Custom/)).toBeTruthy();
  expect(getByText(/other/)).toBeTruthy();
});
