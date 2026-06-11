// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { ActivityBar } from "./ActivityBar";

const initialState = useApp.getState();
let prefsSet: ReturnType<typeof vi.fn>;
let setSectionVisibility: ReturnType<typeof vi.fn>;
let hostOpenExternal: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useApp.setState(initialState, true);
  prefsSet = vi.fn(() => Promise.resolve());
  setSectionVisibility = vi.fn(() => Promise.resolve());
  hostOpenExternal = vi.fn(() => Promise.resolve());
  // Minimal stub: ActivityBar itself only calls prefsSet/setSectionVisibility/
  // hostOpenExternal; "on*" subscriptions return an unsubscribe; everything
  // else resolves undefined (the popovers' mount-time fetches land there
  // harmlessly).
  window.airlock = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === "prefsSet"
          ? prefsSet
          : prop === "setSectionVisibility"
            ? setSectionVisibility
            : prop === "hostOpenExternal"
              ? hostOpenExternal
              : prop.startsWith("on")
                ? () => () => {}
                : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
});

afterEach(cleanup);

it("renders one icon per visible section and skips hidden ones", () => {
  useApp.setState({
    sectionVisibility: {
      ...useApp.getState().sectionVisibility,
      docker: false,
    },
  });
  render(<ActivityBar />);
  expect(screen.getByTitle("Files")).toBeTruthy();
  expect(screen.getByTitle("Git")).toBeTruthy();
  expect(screen.queryByTitle("Docker")).toBeNull();
});

it("click on an inactive icon activates that view and persists it", () => {
  render(<ActivityBar />);
  fireEvent.click(screen.getByTitle("Git"));
  expect(useApp.getState().activeView).toBe("git");
  expect(prefsSet).toHaveBeenCalledWith({
    activeView: "git",
    sidebarVisible: true,
  });
});

it("click on the active icon collapses the sidebar (and persists)", () => {
  render(<ActivityBar />);
  fireEvent.click(screen.getByTitle("Files")); // active by default
  expect(useApp.getState().sidebarVisible).toBe(false);
  expect(prefsSet).toHaveBeenCalledWith({ sidebarVisible: false });
});

it("click on any icon while the sidebar is hidden re-shows it", () => {
  useApp.setState({ sidebarVisible: false });
  render(<ActivityBar />);
  fireEvent.click(screen.getByTitle("Files"));
  expect(useApp.getState().sidebarVisible).toBe(true);
  expect(useApp.getState().activeView).toBe("files");
});

it("right-click offers Hide <Section> wired to setSectionVisibility", () => {
  render(<ActivityBar />);
  fireEvent.contextMenu(screen.getByTitle("Git"));
  fireEvent.click(screen.getByText("Hide Git"));
  expect(setSectionVisibility).toHaveBeenCalledWith("git", false);
});

it("renders the global Accounts/Settings buttons; Settings opens its menu", () => {
  render(<ActivityBar />);
  expect(screen.getByTitle("Accounts")).toBeTruthy();
  fireEvent.click(screen.getByTitle("Settings"));
  expect(screen.getByText("Themes")).toBeTruthy();
});

it("suggestions button opens the GitHub new-issue page in the browser", () => {
  render(<ActivityBar />);
  fireEvent.click(screen.getByTitle("Send a suggestion"));
  expect(hostOpenExternal).toHaveBeenCalledWith(
    "https://github.com/RicardoRamosT/Airlock-IDE/issues/new?template=suggestion.yml",
  );
});

it("suggestions button sits ABOVE Accounts in the bottom rail", () => {
  const { container } = render(<ActivityBar />);
  const bottom = container.querySelector(".activity-bar-bottom");
  const titles = [...(bottom?.querySelectorAll("button.footer-btn") ?? [])].map(
    (b) => b.getAttribute("title"),
  );
  expect(titles).toEqual(["Send a suggestion", "Accounts", "Settings"]);
});
