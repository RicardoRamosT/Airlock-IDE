// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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

beforeEach(() => {
  useApp.setState(initialState, true);
  activityStatus = vi.fn((root: string | null) =>
    Promise.resolve(root ? ciFor(root) : []),
  );
  window.airlock = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === "activityStatus"
          ? activityStatus
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
