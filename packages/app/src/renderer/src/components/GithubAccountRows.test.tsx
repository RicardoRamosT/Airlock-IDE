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

// The reported bug: the row only ever PINNED, so clicking the account it was
// already pinned to just re-pinned it, and the hub had no way back out. The pin
// also installs a per-repo git credential helper, so being stuck pinned is a
// real state, not a cosmetic one -- the popover has always had an Unpin button
// and this surface was the one that could not reach it.
it("unpins on a second click of the account it is already pinned to", async () => {
  // A STATEFUL stub, unlike the shared one: the component deliberately settles
  // on what main actually stored rather than on its own optimistic guess, so a
  // stub that always answers "still pinned" would restore the badge and hide
  // the fix. Behaving like main is the point of the assertion.
  let current: string | null = "RicardoRamosT";
  const setProjectGithubAccount = vi.fn(
    async (_root: string, account: { username: string } | null) => {
      current = account === null ? null : account.username;
    },
  );
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    githubInfo: vi.fn(async () => ({
      gh: {
        installed: true,
        accounts: [
          { host: "github.com", username: "RicardoRamosT", active: true },
        ],
      },
    })),
    resolveGithubAccount: vi.fn(async () =>
      current
        ? {
            source: "override",
            account: { host: "github.com", username: current },
          }
        : { source: "detected", account: null },
    ),
    setProjectGithubAccount,
  };
  render(<GithubAccountRows root="/proj" />);
  await screen.findByText("pinned");

  fireEvent.click(screen.getByText("RicardoRamosT"));
  await waitFor(() =>
    // null is the CLEAR signal -- it removes the override AND the credential
    // helper, main-side.
    expect(setProjectGithubAccount).toHaveBeenCalledWith("/proj", null),
  );
  await waitFor(() => expect(screen.queryByText("pinned")).toBeNull());
});

// Clicking the OTHER account moves the pin. Switching which account a project
// uses must not require unpinning first.
it("moves the pin when a DIFFERENT account is clicked", async () => {
  const { setProjectGithubAccount } = stub(
    [
      { host: "github.com", username: "RicardoRamosT", active: true },
      { host: "github.com", username: "vnricardotrevino", active: false },
    ],
    {
      source: "override",
      account: { host: "github.com", username: "RicardoRamosT" },
    },
  );
  render(<GithubAccountRows root="/proj" />);
  await screen.findByText("pinned");

  fireEvent.click(screen.getByText("vnricardotrevino"));
  await waitFor(() =>
    expect(setProjectGithubAccount).toHaveBeenCalledWith("/proj", {
      host: "github.com",
      username: "vnricardotrevino",
    }),
  );
});

// A toggle has to SAY which way it goes. The badge alone does not tell you a
// second click undoes it -- which is how the missing unpin went unnoticed.
it("names the action each row will perform, in both directions", async () => {
  stub(
    [
      { host: "github.com", username: "RicardoRamosT", active: true },
      { host: "github.com", username: "vnricardotrevino", active: false },
    ],
    {
      source: "override",
      account: { host: "github.com", username: "RicardoRamosT" },
    },
  );
  render(<GithubAccountRows root="/proj" />);
  await screen.findByText("pinned");
  const pinnedRow = screen.getByText("RicardoRamosT").closest("button");
  const otherRow = screen.getByText("vnricardotrevino").closest("button");
  expect(pinnedRow?.getAttribute("title")).toMatch(/^Unpin/);
  expect(pinnedRow?.getAttribute("aria-pressed")).toBe("true");
  expect(otherRow?.getAttribute("title")).toMatch(/^Pin/);
  expect(otherRow?.getAttribute("aria-pressed")).toBe("false");
});

// A failed write must not leave the badge claiming a pin that did not happen:
// the credential helper is installed main-side, so a lying badge means the user
// believes their pushes use an account they do not.
it("re-reads the real pin when the write fails, instead of keeping the guess", async () => {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    githubInfo: vi.fn(async () => ({
      gh: {
        installed: true,
        accounts: [
          { host: "github.com", username: "RicardoRamosT", active: true },
        ],
      },
    })),
    resolveGithubAccount: vi.fn(async () => ({
      source: "detected",
      account: null,
    })),
    setProjectGithubAccount: vi.fn(async () => {
      throw new Error("gh config write failed");
    }),
  };
  render(<GithubAccountRows root="/proj" />);
  fireEvent.click(await screen.findByText("RicardoRamosT"));
  await waitFor(() => expect(screen.queryByText("pinned")).toBeNull());
});
