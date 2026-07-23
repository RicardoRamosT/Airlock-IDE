// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
