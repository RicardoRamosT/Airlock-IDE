// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { composeSectionMeta } from "../lib/sections";
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
      host: false,
    },
  });
  render(<ActivityBar />);
  expect(screen.getByTitle("Files")).toBeTruthy();
  expect(screen.getByTitle("Git")).toBeTruthy();
  expect(screen.queryByTitle("Host")).toBeNull();
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
  // The Accounts button's tooltip is "Accounts -- <github account status>"
  // (same label--status shape as the section icons), so match the label prefix.
  expect(screen.getByTitle(/^Accounts —/)).toBeTruthy();
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
  // Accounts carries a status suffix ("Accounts -- ..."), so compare the labels.
  const titles = [...(bottom?.querySelectorAll("button.footer-btn") ?? [])].map(
    (b) => b.getAttribute("title")?.split(" — ")[0],
  );
  expect(titles).toEqual(["Send a suggestion", "Accounts", "Settings"]);
});

it("renders extension icons after the built-ins, with a divider between", () => {
  useApp.setState({
    sectionMeta: composeSectionMeta([
      { id: "slack", name: "Slack", icon: "comment-discussion" },
    ]),
    sectionVisibility: {
      ...useApp.getState().sectionVisibility,
      "ext:slack": true,
    },
  });
  const { container } = render(<ActivityBar />);
  expect(container.querySelector(".activity-bar-divider")).toBeTruthy();
  const icons = [...container.querySelectorAll(".activity-icon")];
  expect(icons[icons.length - 1]?.getAttribute("title")).toBe("Slack");
});

it("renders the divider before the Extensions hub even with no extensions", () => {
  // The hub itself lives in the extensions group and leads it, so the rail is
  // always split into core / extensions.
  useApp.setState({ sectionMeta: composeSectionMeta([]) });
  const { container } = render(<ActivityBar />);
  expect(container.querySelector(".activity-bar-divider")).toBeTruthy();
  const titles = [...container.querySelectorAll(".activity-icon")].map((n) =>
    n.getAttribute("title"),
  );
  expect(titles[titles.length - 1]).toBe("Extensions");
});

it("shows an extension icon that has NO persisted visibility key", () => {
  // The regression: a freshly-appeared ext:* section has no key in
  // sectionVisibility, and a truthiness filter hid every extension icon.
  useApp.setState({
    sectionMeta: composeSectionMeta([
      { id: "slack", name: "Slack", icon: "comment-discussion" },
    ]),
    // Deliberately WITHOUT an "ext:slack" entry.
  });
  const { container } = render(<ActivityBar />);
  const titles = [...container.querySelectorAll(".activity-icon")].map((n) =>
    n.getAttribute("title"),
  );
  expect(titles).toContain("Slack");
  expect(container.querySelector(".activity-bar-divider")).toBeTruthy();
});

// The hub's sidebar body was a 260px copy of a full-width page whose main
// content was a button that opened that page. The icon opens the page directly.
it("hub icon opens the Extensions page and collapses the sidebar", async () => {
  useApp.setState({ sidebarVisible: true, appPage: null, activeView: "files" });
  render(<ActivityBar />);
  fireEvent.click(screen.getByTitle("Extensions"));
  expect(useApp.getState().appPage).toBe("extensions");
  expect(useApp.getState().sidebarVisible).toBe(false);
  // "collapses the sidebar" means PERSISTED collapsed -- otherwise the next
  // prefs hydrate re-opens an empty sidebar.
  expect(prefsSet).toHaveBeenCalledWith({ sidebarVisible: false });
  // It must NOT become the sidebar view -- there is no body to show, and
  // nothing may write it as activeView.
  expect(useApp.getState().activeView).toBe("files");
  expect(prefsSet).not.toHaveBeenCalledWith(
    expect.objectContaining({ activeView: "extensions" }),
  );
});

// Reported from the UI: clicking the icon a second time "does not close it and
// closes the sidebar". The handler ran the same open-and-collapse branch every
// time, so the second click did nothing visible EXCEPT take the sidebar away --
// leaving neither a panel nor an obvious way back. The icon toggles now, like
// every other icon in this rail.
it("hub icon CLOSES the page on a second click", async () => {
  useApp.setState({ sidebarVisible: true, appPage: null, activeView: "files" });
  render(<ActivityBar />);
  const icon = screen.getByTitle("Extensions");
  fireEvent.click(icon);
  expect(useApp.getState().appPage).toBe("extensions");

  fireEvent.click(icon);
  expect(useApp.getState().appPage).toBeNull();
  // ...and the tab is discarded, not merely hidden.
  expect(useApp.getState().extensionsTabOpen).toBe(false);
});

it("gives the sidebar BACK when the hub is closed, since the hub took it", async () => {
  useApp.setState({ sidebarVisible: true, appPage: null, activeView: "files" });
  render(<ActivityBar />);
  const icon = screen.getByTitle("Extensions");
  fireEvent.click(icon);
  expect(useApp.getState().sidebarVisible).toBe(false);

  fireEvent.click(icon);
  expect(useApp.getState().sidebarVisible).toBe(true);
  // Persisted, or the next prefs hydrate re-collapses it.
  expect(prefsSet).toHaveBeenCalledWith({ sidebarVisible: true });
});

it("does NOT force the sidebar open if it was already collapsed before the hub", async () => {
  // Someone who deliberately works with no sidebar must not have one shoved
  // back at them for having visited the hub.
  useApp.setState({
    sidebarVisible: false,
    appPage: null,
    activeView: "files",
  });
  render(<ActivityBar />);
  const icon = screen.getByTitle("Extensions");
  fireEvent.click(icon);
  fireEvent.click(icon);
  expect(useApp.getState().appPage).toBeNull();
  expect(useApp.getState().sidebarVisible).toBe(false);
  expect(prefsSet).not.toHaveBeenCalledWith({ sidebarVisible: true });
});

it("re-opens the hub when its page was hidden by selecting a project tab", async () => {
  // appPage null with the tab still open: the page is hidden, not closed, so
  // the icon must OPEN rather than toggle-close.
  useApp.setState({
    sidebarVisible: true,
    appPage: null,
    extensionsTabOpen: true,
    activeView: "files",
  });
  render(<ActivityBar />);
  fireEvent.click(screen.getByTitle("Extensions"));
  expect(useApp.getState().appPage).toBe("extensions");
});

it("hub icon reads active while its page is showing", () => {
  useApp.setState({ appPage: "extensions", sidebarVisible: false });
  render(<ActivityBar />);
  expect(screen.getByTitle("Extensions").className).toContain("active");
});

it("hides an extension icon explicitly set to false", () => {
  useApp.setState({
    sectionMeta: composeSectionMeta([{ id: "slack", name: "Slack" }]),
    sectionVisibility: {
      ...useApp.getState().sectionVisibility,
      "ext:slack": false,
    },
  });
  const { container } = render(<ActivityBar />);
  const titles = [...container.querySelectorAll(".activity-icon")].map((n) =>
    n.getAttribute("title"),
  );
  expect(titles).not.toContain("Slack");
  // The divider stays: the Extensions hub still occupies the group.
  expect(container.querySelector(".activity-bar-divider")).toBeTruthy();
});
