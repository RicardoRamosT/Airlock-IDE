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
  };
}

it("renders entries newest-first with tag + text", async () => {
  stub([
    { ts: 2000, tag: "change", text: "did X" },
    { ts: 1000, tag: "note", text: "noted Y" },
  ]);
  render(<ChangelogView root="/repo" />);
  expect(await screen.findByText("did X")).toBeTruthy();
  expect(screen.getByText("noted Y")).toBeTruthy();
  expect(screen.getByText("change")).toBeTruthy();
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
    { ts: 2000, tag: "note", text: "no ctx" },
  ]);
  render(<ChangelogView root="/repo" />);
  expect(await screen.findByText("with ctx")).toBeTruthy();
  expect(screen.queryByText(/reason/)).toBeNull(); // hidden until toggled
  fireEvent.click(screen.getByRole("button", { name: /details/i }));
  expect(screen.getByText(/reason/)).toBeTruthy();
  // the no-details entry has no toggle -> exactly one toggle total (now "hide")
  expect(screen.getAllByRole("button", { name: /details|hide/i })).toHaveLength(
    1,
  );
});
