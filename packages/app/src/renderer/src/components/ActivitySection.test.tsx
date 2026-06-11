// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActivityItem } from "../../../shared/ipc";
import { useApp } from "../store";
import { ActivitySection } from "./ActivitySection";

const initialState = useApp.getState();

const ciFor = (root: string): ActivityItem[] =>
  root === "/tmp/projA"
    ? [
        {
          id: "ci-a",
          kind: "ci",
          title: "CI projA",
          subtitle: "feature/TLOS-1",
          state: "done",
        } as ActivityItem,
      ]
    : [];

let activityStatus: ReturnType<typeof vi.fn>;
let hostOpenExternal: ReturnType<typeof vi.fn>;
let activityDismiss: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useApp.setState(initialState, true);
  activityStatus = vi.fn((root: string | null) =>
    Promise.resolve(root ? ciFor(root) : []),
  );
  hostOpenExternal = vi.fn(() => Promise.resolve(undefined));
  activityDismiss = vi.fn(() => Promise.resolve(undefined));
  window.airlock = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === "activityStatus"
          ? activityStatus
          : prop === "hostOpenExternal"
            ? hostOpenExternal
            : prop === "activityDismiss"
              ? activityDismiss
              : prop.startsWith("on")
                ? () => () => {}
                : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
});

afterEach(cleanup);

// The split-staleness regression: the sidebar follows the focused pane, so the
// Activity feed must re-bind (refetch with the NEW pane's root and drop the
// old project's items) when focus moves to another project's pane.
it("fetches with the pane's root and re-binds when the focused project changes", async () => {
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    tabs: [
      { id: t1, root: "/tmp/projA" },
      { id: "t2", root: "/tmp/projB" },
    ],
    activeTabId: t1,
    tabState: {
      ...useApp.getState().tabState,
      [t1]: { root: "/tmp/projA" } as never,
      t2: { root: "/tmp/projB" } as never,
    },
  });

  render(<ActivitySection />);
  await act(async () => {});
  // Fetched explicitly for the focused pane's project, and shows its CI.
  expect(activityStatus).toHaveBeenCalledWith("/tmp/projA");
  expect(screen.getByText("CI projA")).toBeTruthy();

  // Focus the other project's pane: the feed must refetch for projB and the
  // stale projA entry must disappear (projB has nothing running).
  await act(async () => {
    useApp.setState({ activeTabId: "t2" });
  });
  expect(activityStatus).toHaveBeenCalledWith("/tmp/projB");
  expect(screen.queryByText("CI projA")).toBeNull();
  expect(screen.getByText("Nothing active")).toBeTruthy();
});

// --- Row overflow menu ("..." replacing the link + dismiss buttons) --------

const MENU_ITEMS: ActivityItem[] = [
  {
    id: "ci-1",
    kind: "ci",
    title: "Frontend",
    subtitle: "feature/x",
    state: "done",
    href: "https://github.com/run/1",
    steps: [{ name: "build", status: "completed", conclusion: "success" }],
  } as ActivityItem,
  {
    id: "docker-1",
    kind: "docker",
    title: "db",
    subtitle: "container",
    state: "done",
  } as ActivityItem,
];

// Feed the two fixture entries regardless of root (the component renders the
// active tab's feed; these tests only exercise the row menu).
function seedMenuItems(): void {
  activityStatus.mockImplementation(() => Promise.resolve(MENU_ITEMS));
}

it('the "..." menu lists Open on GitHub + Dismiss for a linked entry (old buttons gone)', async () => {
  seedMenuItems();
  render(<ActivitySection />);

  const more = await screen.findAllByTitle("Activity actions");
  expect(more).toHaveLength(2);
  fireEvent.click(more[0] as HTMLElement);

  expect(screen.getByText("Open on GitHub")).toBeTruthy();
  expect(screen.getByText("Dismiss")).toBeTruthy();
  // The standalone buttons are gone (they used title=, the menu items use text).
  expect(screen.queryByTitle("Open on GitHub")).toBeNull();
  expect(screen.queryByTitle("Dismiss")).toBeNull();
});

it("an entry without an href shows only Dismiss", async () => {
  seedMenuItems();
  render(<ActivitySection />);

  const more = await screen.findAllByTitle("Activity actions");
  fireEvent.click(more[1] as HTMLElement); // docker-1 has no href

  expect(screen.queryByText("Open on GitHub")).toBeNull();
  expect(screen.getByText("Dismiss")).toBeTruthy();
});

it("Open on GitHub opens the captured href and closes the menu", async () => {
  seedMenuItems();
  render(<ActivitySection />);

  const more = await screen.findAllByTitle("Activity actions");
  fireEvent.click(more[0] as HTMLElement);
  fireEvent.click(screen.getByText("Open on GitHub"));

  expect(hostOpenExternal).toHaveBeenCalledWith("https://github.com/run/1");
  expect(screen.queryByText("Dismiss")).toBeNull();
});

it("Dismiss dismisses the entry by id", async () => {
  seedMenuItems();
  render(<ActivitySection />);

  const more = await screen.findAllByTitle("Activity actions");
  fireEvent.click(more[0] as HTMLElement);
  fireEvent.click(screen.getByText("Dismiss"));

  expect(activityDismiss).toHaveBeenCalledWith("ci-1");
});

it("backdrop click and Escape both close the menu", async () => {
  seedMenuItems();
  render(<ActivitySection />);

  const more = await screen.findAllByTitle("Activity actions");
  fireEvent.click(more[0] as HTMLElement);
  fireEvent.click(screen.getByLabelText("Close menu"));
  expect(screen.queryByText("Dismiss")).toBeNull();

  fireEvent.click(more[0] as HTMLElement);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByText("Dismiss")).toBeNull();
});

it('clicking "..." does not toggle the steps expander', async () => {
  seedMenuItems();
  render(<ActivitySection />);

  const more = await screen.findAllByTitle("Activity actions");
  fireEvent.click(more[0] as HTMLElement); // ci-1 HAS steps
  expect(screen.queryByText("build")).toBeNull();
});
