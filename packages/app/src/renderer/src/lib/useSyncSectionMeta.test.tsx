// @vitest-environment jsdom
//
// The rail is PROJECT-SCOPED now, and that turned a pre-existing ordering
// hazard into a visible bug.
//
// switchTab commits the new root to the store SYNCHRONOUSLY, then fires
// workspace:setActive at main fire-and-forget ("nothing in the UI awaits it").
// This hook re-runs the moment the store root changes and asks main for the
// extension list -- so the two IPCs race, and extensions:list frequently
// arrives first. Main then answers with the PREVIOUS project's relevance, and
// because the rail does not poll, the wrong answer sticks until the next
// window focus. Observed: switching to a project with docker-compose.yml kept
// the previous project's rail, with no Docker icon.
//
// The fix is that the question carries its own subject, the way dbList(root)
// already does, instead of depending on a separately-synchronised global.
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { useSyncSectionMeta } from "./useSyncSectionMeta";

const initialState = useApp.getState();
let extensionsList: ReturnType<typeof vi.fn>;

beforeEach(() => {
  extensionsList = vi.fn(async () => []);
  window.airlock = new Proxy(
    { extensionsList },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});
afterEach(() => vi.clearAllMocks());

it("asks about the project it is rendering for, not whichever main last heard about", async () => {
  useApp.setState({ root: "/Projects/Trackview" });
  renderHook(() => useSyncSectionMeta());
  await waitFor(() => expect(extensionsList).toHaveBeenCalled());
  expect(extensionsList).toHaveBeenCalledWith("/Projects/Trackview");
});

it("re-asks with the new root when the project changes", async () => {
  useApp.setState({ root: "/Projects/airlock" });
  renderHook(() => useSyncSectionMeta());
  await waitFor(() =>
    expect(extensionsList).toHaveBeenCalledWith("/Projects/airlock"),
  );

  useApp.setState({ root: "/Projects/Trackview" });
  await waitFor(() =>
    expect(extensionsList).toHaveBeenCalledWith("/Projects/Trackview"),
  );
});

it("passes null with no project focused, so main answers account-wide", async () => {
  useApp.setState({ root: null });
  renderHook(() => useSyncSectionMeta());
  await waitFor(() => expect(extensionsList).toHaveBeenCalled());
  expect(extensionsList).toHaveBeenCalledWith(null);
});
