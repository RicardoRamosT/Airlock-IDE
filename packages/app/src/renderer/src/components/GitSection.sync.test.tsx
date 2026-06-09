// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitStatus } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useApp } from "../store";
import { GitSection } from "./GitSection";

const initialState = useApp.getState();
const ROOT = "/workspace";
const STATUS: GitStatus = {
  branch: { head: "main", upstream: null, ahead: 0, behind: 0 },
  staged: [],
  unstaged: [],
  untracked: [],
};
let gitPush: ReturnType<typeof vi.fn>;

beforeEach(() => {
  gitPush = vi.fn(() => Promise.resolve());
  window.airlock = new Proxy(
    {
      gitIsRepo: () => Promise.resolve(true),
      gitStatus: () => Promise.resolve(STATUS),
      gitBranches: () => Promise.resolve(["main"]),
      gitPush,
      resolveGithubAccount: () =>
        Promise.resolve({ account: null, source: "none", protocol: "unknown" }),
      githubInfo: () =>
        Promise.resolve({
          gh: { installed: true, accounts: [] },
          identity: { name: null, email: null },
        }),
    },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
  const tabId = useApp.getState().tabs[0]?.id as string;
  const cur = useApp.getState().tabState[tabId];
  if (cur)
    useApp.setState({
      tabState: {
        ...useApp.getState().tabState,
        [tabId]: { ...cur, root: ROOT },
      },
    });
});
afterEach(() => cleanup());

it("shows Publish (no upstream) and pushes on click", async () => {
  const tabId = useApp.getState().tabs[0]?.id as string;
  render(
    <ProjectPaneContext.Provider value={tabId}>
      <GitSection />
    </ProjectPaneContext.Provider>,
  );
  const btn = await waitFor(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent === "Publish",
    );
    if (!b) throw new Error("no Publish button");
    return b as HTMLButtonElement;
  });
  fireEvent.click(btn);
  await waitFor(() => expect(gitPush).toHaveBeenCalledWith(ROOT));
});

it("keeps a failed sync's error visible (does not flash away)", async () => {
  // gitPush rejects; the error must PERSIST after the post-op refresh, not get
  // wiped by refresh()'s success-path setError(null).
  window.airlock = new Proxy(
    {
      gitIsRepo: () => Promise.resolve(true),
      gitStatus: () => Promise.resolve(STATUS),
      gitBranches: () => Promise.resolve(["main"]),
      gitPush: () => Promise.reject(new Error("no tracking information boom")),
      resolveGithubAccount: () =>
        Promise.resolve({ account: null, source: "none", protocol: "unknown" }),
      githubInfo: () =>
        Promise.resolve({
          gh: { installed: true, accounts: [] },
          identity: { name: null, email: null },
        }),
    },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  const tabId = useApp.getState().tabs[0]?.id as string;
  const { container } = render(
    <ProjectPaneContext.Provider value={tabId}>
      <GitSection />
    </ProjectPaneContext.Provider>,
  );
  const btn = await waitFor(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent === "Publish",
    );
    if (!b) throw new Error("no Publish button");
    return b as HTMLButtonElement;
  });
  fireEvent.click(btn);
  // Under the old (buggy) ordering this would be wiped; the fix keeps it shown.
  await waitFor(() =>
    expect(container.querySelector(".modal-error")?.textContent).toContain(
      "no tracking information boom",
    ),
  );
});
