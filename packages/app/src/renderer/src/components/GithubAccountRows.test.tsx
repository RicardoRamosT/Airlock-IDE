// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GithubAccountRows } from "./GithubAccountRows";

afterEach(cleanup);

function stub(
  accounts: { host: string; username: string; active: boolean }[],
  resolved: unknown = null,
) {
  const setProjectGithubAccount = vi.fn(async () => {});
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    githubInfo: vi.fn(async () => ({ gh: { installed: true, accounts } })),
    resolveGithubAccount: vi.fn(async () => resolved),
    setProjectGithubAccount,
  };
  return { setProjectGithubAccount };
}

it("lists every gh account", async () => {
  stub([
    { host: "github.com", username: "RicardoRamosT", active: true },
    { host: "github.com", username: "vnricardotrevino", active: false },
  ]);
  render(<GithubAccountRows root="/proj" />);
  expect(await screen.findByText("RicardoRamosT")).toBeTruthy();
  expect(screen.getByText("vnricardotrevino")).toBeTruthy();
});

it("pins the project through the SAME IPC the popover uses", async () => {
  // Not a second pinning path: github:setProjectAccount is the only one that
  // also installs the local credential helper, and a parallel route that
  // skipped it is exactly how a project ends up pushing as the wrong account.
  const { setProjectGithubAccount } = stub([
    { host: "github.com", username: "RicardoRamosT", active: true },
  ]);
  render(<GithubAccountRows root="/proj" />);
  fireEvent.click(await screen.findByText("RicardoRamosT"));
  await waitFor(() =>
    // TWO arguments, the second an OBJECT. A bare username would clear the pin.
    expect(setProjectGithubAccount).toHaveBeenCalledWith("/proj", {
      host: "github.com",
      username: "RicardoRamosT",
    }),
  );
});

it("shows which account is currently pinned", async () => {
  stub(
    [
      { host: "github.com", username: "RicardoRamosT", active: true },
      { host: "github.com", username: "other", active: false },
    ],
    { source: "override", account: { host: "github.com", username: "other" } },
  );
  render(<GithubAccountRows root="/proj" />);
  expect(await screen.findByText("pinned")).toBeTruthy();
});

it("shows NO pin badge when the project is on auto-detect", async () => {
  // source !== "override" means nothing is pinned; a badge here would claim a
  // pin the project does not have.
  stub([{ host: "github.com", username: "RicardoRamosT", active: true }], {
    source: "detected",
    account: { host: "github.com", username: "RicardoRamosT" },
  });
  render(<GithubAccountRows root="/proj" />);
  await screen.findByText("RicardoRamosT");
  expect(screen.queryByText("pinned")).toBeNull();
});

it("says so rather than rendering blank when gh has no accounts", async () => {
  stub([]);
  render(<GithubAccountRows root="/proj" />);
  expect(await screen.findByText(/No GitHub accounts/)).toBeTruthy();
});

it("does nothing without a project root", async () => {
  // Pinning is per-project; with no project there is nothing to pin to.
  stub([{ host: "github.com", username: "a", active: true }]);
  render(<GithubAccountRows root={null} />);
  expect(await screen.findByText(/Open a project/)).toBeTruthy();
});
