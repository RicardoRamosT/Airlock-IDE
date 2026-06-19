// @vitest-environment jsdom
//
// Perf regression: a terminal TITLE change must not re-render the whole project
// strip. Claude Code animates a spinner glyph in its terminal title (~10Hz while
// working), and setTerminalTitle rewrites the whole tabTerminals map each frame.
// ProjectTabs used to subscribe to the ENTIRE map, so with N active sessions the
// strip re-rendered ~10N times/sec, each render O(N) -> O(N^2) main-thread work
// -> beachball with many project tabs (16GB M5, CPU-bound). The strip only needs
// each tab's derived "working" boolean, so a title-only change must be a no-op.

import { act, cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
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

// Three tabs, each with one terminal holding a pty -- mimics three active Claude
// sessions whose title spinners churn tabTerminals.
function seedTabsWithTerminals(): void {
  useApp.setState({
    openProjectsAsTabs: true,
    tabs: [
      { id: "t1", root: "/Users/x/alpha" },
      { id: "t2", root: "/Users/x/beta" },
      { id: "t3", root: "/Users/x/gamma" },
    ],
    activeTabId: "t1",
    stripOrder: [],
    tabTerminals: {
      t1: {
        terminals: [{ id: "e1", title: "a", renamed: false, ptyId: "p1" }],
        activeTerminalId: "e1",
        splitTerminalId: null,
        claudeAutoId: null,
      },
      t2: {
        terminals: [{ id: "e2", title: "b", renamed: false, ptyId: "p2" }],
        activeTerminalId: "e2",
        splitTerminalId: null,
        claudeAutoId: null,
      },
      t3: {
        terminals: [{ id: "e3", title: "c", renamed: false, ptyId: "p3" }],
        activeTerminalId: "e3",
        splitTerminalId: null,
        claudeAutoId: null,
      },
    },
  });
}

it("a terminal title change does not re-render the project strip", () => {
  seedTabsWithTerminals();
  let renders = 0;
  render(
    <Profiler id="strip" onRender={() => renders++}>
      <ProjectTabs />
    </Profiler>,
  );
  const afterMount = renders;
  expect(afterMount).toBeGreaterThan(0); // sanity: it mounted

  // A spinner-frame title update (the exact churn Claude produces ~10Hz).
  act(() => {
    useApp.getState().setTerminalTitle("e2", "⠂ working", false);
  });

  expect(renders).toBe(afterMount); // strip must NOT re-render on a title change
});

it("a working-state change DOES re-render the project strip (dot must update)", () => {
  seedTabsWithTerminals();
  let renders = 0;
  render(
    <Profiler id="strip" onRender={() => renders++}>
      <ProjectTabs />
    </Profiler>,
  );
  const afterMount = renders;

  act(() => {
    useApp.getState().applyPtyStatus("p2", true); // a session starts working
  });

  expect(renders).toBeGreaterThan(afterMount); // the working dot must reflect it
});
