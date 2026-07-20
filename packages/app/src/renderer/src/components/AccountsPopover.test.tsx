// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { AccountsPopover } from "./AccountsPopover";

afterEach(() => {
  cleanup();
  useApp.setState({ githubAutoSwitch: true });
});

const mockApi = (over: Record<string, unknown> = {}) => {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    githubInfo: vi.fn(() =>
      Promise.resolve({
        gh: {
          installed: true,
          accounts: [{ host: "github.com", username: "octocat", active: true }],
        },
        identity: { name: "octocat", email: null },
      }),
    ),
    resolveGithubAccount: vi.fn(() =>
      Promise.resolve({ account: null, source: "none", protocol: "https" }),
    ),
    setProjectGithubAccount: vi.fn(() => Promise.resolve()),
    githubSwitch: vi.fn(() => Promise.resolve()),
    prefsSet: vi.fn(() => Promise.resolve({})),
    ...over,
  };
};

const focusProject = (root: string | null) =>
  useApp.setState({
    activeTabId: "t1",
    tabState: (root ? { t1: { root } } : {}) as never,
  });

it("pins the active account to the focused project", async () => {
  focusProject("/repo");
  mockApi();
  render(<AccountsPopover onClose={() => {}} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /^pin octocat$/i }),
  );
  await waitFor(() =>
    expect(window.airlock.setProjectGithubAccount).toHaveBeenCalledWith(
      "/repo",
      { host: "github.com", username: "octocat" },
    ),
  );
});

it("shows Unpin (not Pin) when the project is already pinned", async () => {
  focusProject("/repo");
  mockApi({
    resolveGithubAccount: vi.fn(() =>
      Promise.resolve({
        account: { host: "github.com", username: "octocat" },
        source: "override",
        protocol: "https",
      }),
    ),
  });
  render(<AccountsPopover onClose={() => {}} />);
  expect(await screen.findByText(/pinned to/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: /unpin/i })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^pin octocat$/i })).toBeNull();
});

it("keeps rows switchable when the active account doesn't match the pin", async () => {
  focusProject("/repo");
  mockApi({
    githubInfo: vi.fn(() =>
      Promise.resolve({
        gh: {
          installed: true,
          accounts: [
            { host: "github.com", username: "RicardoRamosT", active: false },
            { host: "github.com", username: "vnricardotrevino", active: true },
          ],
        },
        identity: { name: "RicardoRamosT", email: null },
      }),
    ),
    resolveGithubAccount: vi.fn(() =>
      Promise.resolve({
        account: { host: "github.com", username: "RicardoRamosT" },
        source: "override",
        protocol: "https",
      }),
    ),
  });
  render(<AccountsPopover onClose={() => {}} />);
  // Pinned to RicardoRamosT but active is vnricardotrevino: the pinned row must
  // stay clickable so the user can set it active (never a locked wrong state).
  const row = await screen.findByRole("button", { name: /RicardoRamosT/i });
  expect((row as HTMLButtonElement).disabled).toBe(false);
});

it("persists the auto-switch toggle via prefsSet", async () => {
  focusProject("/repo");
  mockApi();
  render(<AccountsPopover onClose={() => {}} />);
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /auto-switch account/i }),
  );
  await waitFor(() =>
    expect(window.airlock.prefsSet).toHaveBeenCalledWith({
      githubAutoSwitch: false,
    }),
  );
});
