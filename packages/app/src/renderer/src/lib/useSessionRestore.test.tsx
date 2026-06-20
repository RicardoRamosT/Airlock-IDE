// @vitest-environment jsdom
//
// Regression: session restore must reopen each project as a FRESH tab (so its
// terminal spawns in the project root) and drop the boot blank tab -- NOT reuse
// the blank tab via fillActiveTab, which keeps the blank tab's $HOME terminal
// (wrong cwd, and claude --continue then resumes the wrong directory).

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { useSessionRestore } from "./useSessionRestore";

const initialState = useApp.getState();

beforeEach(() => {
  window.airlock = new Proxy(
    {
      sessionGet: () =>
        Promise.resolve({
          version: 1 as const,
          tabs: [{ root: "/Users/x/airlock", hadClaude: true }],
          activeRoot: "/Users/x/airlock",
          split: null,
        }),
      dirExists: () => Promise.resolve(true),
    },
    {
      get: (t, p) =>
        (t as Record<string, unknown>)[p as string] ??
        (() => Promise.resolve(undefined)),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
  useApp.setState({ layoutHydrated: true, restoreSession: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness() {
  useSessionRestore();
  return null;
}

it("reopens the project as a fresh tab, drops the boot blank tab, marks resume", async () => {
  const blankId = useApp.getState().activeTabId; // the boot blank tab
  render(<Harness />);
  await waitFor(() => expect(useApp.getState().sessionRestoreDone).toBe(true));
  const s = useApp.getState();
  // The boot blank tab (whose terminal spawned in $HOME) must be gone -- the
  // project is opened as a NEW tab whose terminal spawns in the project root.
  expect(s.tabs.find((t) => t.id === blankId)).toBeUndefined();
  expect(s.tabs).toHaveLength(1);
  expect(s.tabs[0]?.root).toBe("/Users/x/airlock");
  // The Claude tab is marked for lazy --continue resume.
  expect(s.pendingResume.has(s.tabs[0]?.id ?? "")).toBe(true);
});
