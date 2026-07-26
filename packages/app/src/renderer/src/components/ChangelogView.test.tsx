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

it("shows an empty state with a CTA when there are no entries", async () => {
  stub([]);
  render(<ChangelogView root="/repo" />);
  await waitFor(() =>
    expect(screen.getByText(/No changelog yet/)).toBeTruthy(),
  );
  expect(
    screen.getByRole("button", { name: /ask claude to write the changelog/i }),
  ).toBeTruthy();
});

it("empty-state CTA pastes a seed prompt into the project's terminal", async () => {
  stub([]);
  useApp.setState({ tabs: [{ id: "t1", root: "/repo" }] });
  const spy = vi
    .spyOn(useApp.getState(), "sendToClaudeTerminal")
    .mockReturnValue(true);
  render(<ChangelogView root="/repo" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /ask claude to write the changelog/i,
    }),
  );
  // Seeding is inherently many entries, so the prompt must steer Claude to the
  // BULK tool (and to dating entries via ts) rather than looping the single-entry
  // one -- that was the whole point of add_changelog_entries.
  const [prompt, tabId] = spy.mock.calls[0] ?? [];
  expect(tabId).toBe("t1");
  expect(prompt).toContain("changelog");
  expect(prompt).toContain("add_changelog_entries");
  expect(prompt).toContain("ts");
  spy.mockRestore();
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

it("Add note -> composer -> calls journalAddNote", async () => {
  stub([{ ts: 1000, tag: "note", text: "existing" }]);
  render(<ChangelogView root="/repo" />);
  fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
  fireEvent.click(screen.getByRole("button", { name: /add note/i }));
  fireEvent.change(screen.getByPlaceholderText("Title"), {
    target: { value: "new note" },
  });
  fireEvent.change(screen.getByPlaceholderText(/details/i), {
    target: { value: "**why**" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const api = (window as unknown as { airlock: Record<string, unknown> })
    .airlock;
  await waitFor(() =>
    expect(api.journalAddNote).toHaveBeenCalledWith(
      "/repo",
      "new note",
      "**why**",
    ),
  );
});

it("Edit note -> prefilled composer -> calls journalUpdateNote with ts", async () => {
  stub([{ ts: 4242, tag: "note", text: "editable", details: "d" }]);
  render(<ChangelogView root="/repo" />);
  fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
  fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
  const title = screen.getByPlaceholderText("Title") as HTMLInputElement;
  expect(title.value).toBe("editable");
  fireEvent.change(title, { target: { value: "edited" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const api = (window as unknown as { airlock: Record<string, unknown> })
    .airlock;
  await waitFor(() =>
    expect(api.journalUpdateNote).toHaveBeenCalledWith(
      "/repo",
      4242,
      "edited",
      "d",
    ),
  );
});

it("Delete note -> confirm -> calls journalDeleteNote", async () => {
  stub([{ ts: 77, tag: "note", text: "doomed" }]);
  render(<ChangelogView root="/repo" />);
  fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
  fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
  const api = (window as unknown as { airlock: Record<string, unknown> })
    .airlock;
  await waitFor(() =>
    expect(api.journalDeleteNote).toHaveBeenCalledWith("/repo", 77),
  );
});

it("Changes tab has no note actions", async () => {
  stub([{ ts: 1, tag: "change", text: "shipped" }]);
  render(<ChangelogView root="/repo" />);
  await screen.findByText("shipped");
  expect(screen.queryByRole("button", { name: /add note/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
});
