// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChangelogView } from "./ChangelogView";

afterEach(cleanup);

function stub(entries: unknown) {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    journalGet: vi.fn(() => Promise.resolve(entries)),
    onJournalChanged: vi.fn(() => () => {}),
    journalAddNote: vi.fn(() => Promise.resolve({ ok: true })),
    journalUpdateNote: vi.fn(() => Promise.resolve({ ok: true })),
    journalDeleteNote: vi.fn(() => Promise.resolve({ ok: true })),
  };
}

it("Changes tab shows change-family entries; Notes tab shows notes", async () => {
  stub([
    { ts: 3000, tag: "change", text: "shipped X" },
    { ts: 2000, tag: "fix", text: "fixed Y" },
    { ts: 1000, tag: "note", text: "noted Z" },
  ]);
  render(<ChangelogView root="/repo" />);
  expect(await screen.findByText("shipped X")).toBeTruthy();
  expect(screen.getByText("fixed Y")).toBeTruthy();
  expect(screen.queryByText("noted Z")).toBeNull(); // note hidden on Changes
  fireEvent.click(screen.getByRole("button", { name: "Notes" }));
  expect(await screen.findByText("noted Z")).toBeTruthy();
  expect(screen.queryByText("shipped X")).toBeNull(); // change hidden on Notes
});

it("search filters the active tab", async () => {
  stub([
    { ts: 3000, tag: "change", text: "alpha ships" },
    { ts: 2000, tag: "change", text: "beta ships" },
  ]);
  render(<ChangelogView root="/repo" />);
  await screen.findByText("alpha ships");
  fireEvent.change(screen.getByPlaceholderText(/search/i), {
    target: { value: "beta" },
  });
  expect(screen.queryByText("alpha ships")).toBeNull();
  expect(screen.getByText("beta ships")).toBeTruthy();
});

it("shows an empty state when there are no entries", async () => {
  stub([]);
  render(<ChangelogView root="/repo" />);
  await waitFor(() =>
    expect(screen.getByText(/No changelog entries yet/)).toBeTruthy(),
  );
});

it("expands details markdown on toggle; no toggle without details", async () => {
  stub([
    { ts: 3000, tag: "change", text: "with ctx", details: "the **reason**" },
    { ts: 2000, tag: "change", text: "no ctx" },
  ]);
  render(<ChangelogView root="/repo" />);
  expect(await screen.findByText("with ctx")).toBeTruthy();
  expect(screen.queryByText(/reason/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /details/i }));
  expect(screen.getByText(/reason/)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /details|hide/i })).toHaveLength(
    1,
  );
});
