// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AtlasPanel } from "./AtlasPanel";

afterEach(cleanup);

let refreshCb: (() => void) | null = null;

const api = {
  atlasState: vi.fn(async () => ({
    acknowledged: true,
    disclosure: "",
    mode: "subscription" as const,
    lastView: "brief" as "brief" | "chat",
  })),
  atlasBrief: vi.fn(async () => ({ day: "2026-08-30", text: "YESTERDAY" })),
  atlasSetView: vi.fn(async (_v: "brief" | "chat") => {}),
  atlasConcerns: vi.fn(async () => [] as unknown[]),
  atlasTurns: vi.fn(async () => [] as { role: string; text: string }[]),
  atlasSend: vi.fn(async (_m: string) => "ok"),
  atlasSessions: vi.fn(async () => []),
  atlasNewChat: vi.fn(async () => {}),
  onAtlasRefresh: (cb: () => void) => {
    refreshCb = cb;
    return () => {
      refreshCb = null;
    };
  },
};

beforeEach(() => {
  refreshCb = null;
  for (const fn of Object.values(api)) {
    if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
  }
  api.atlasState.mockResolvedValue({
    acknowledged: true,
    disclosure: "",
    mode: "subscription",
    lastView: "brief",
  });
  (window as unknown as { airlock: unknown }).airlock = api;
});

it("opens on the debrief when that is the persisted view", async () => {
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText("YESTERDAY")).toBeTruthy());
  // The toggle offers the OTHER view.
  expect(screen.getByRole("button", { name: "Chat" })).toBeTruthy();
});

it("REOPENS ON THE CHAT when that is where the user last was", async () => {
  // The bug: showChat was component state defaulting to false, so closing a
  // mid-conversation panel and reopening it landed on the debrief with the
  // conversation apparently gone. The panel is hosted by four surfaces across
  // three windows, so the view has to outlive any one of them.
  api.atlasState.mockResolvedValue({
    acknowledged: true,
    disclosure: "",
    mode: "subscription",
    lastView: "chat",
  });
  render(<AtlasPanel />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Debrief" })).toBeTruthy(),
  );
  expect(screen.queryByText("YESTERDAY")).toBeNull();
});

it("persists the view when the user toggles it", async () => {
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText("YESTERDAY")).toBeTruthy());
  screen.getByRole("button", { name: "Chat" }).click();
  await waitFor(() => expect(api.atlasSetView).toHaveBeenCalledWith("chat"));
  screen.getByRole("button", { name: "Debrief" }).click();
  await waitFor(() => expect(api.atlasSetView).toHaveBeenCalledWith("brief"));
});

it("does not yank the user back on a REFRESH after they switched view", async () => {
  // load() is also the refresh handler and closes over its initial state, so
  // seeding off a piece of state here would re-apply the stored view on every
  // refresh and pull the user out of the chat mid-sentence.
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText("YESTERDAY")).toBeTruthy());
  screen.getByRole("button", { name: "Chat" }).click();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Debrief" })).toBeTruthy(),
  );

  // A refresh arrives (a new debrief composed, say) while the stored pref still
  // says "brief" because the write is async.
  refreshCb?.();
  await waitFor(() => expect(api.atlasState).toHaveBeenCalledTimes(2));
  // Still in the chat.
  expect(screen.getByRole("button", { name: "Debrief" })).toBeTruthy();
});

it("says the debrief could not be LOADED, not that none exists", async () => {
  // "No debrief yet. Atlas writes one each morning" is a confident, specific,
  // wrong claim to make when the read simply failed.
  api.atlasBrief.mockRejectedValueOnce(new Error("atlas db host exited (5)"));
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy());
  expect(screen.queryByText(/no debrief yet/i)).toBeNull();
});

const CONCERN = {
  key: "/p/airlock|no-remote",
  project: "airlock",
  title: "no remote",
  detail: "airlock has no upstream.",
  ageDays: 6,
  trend: { from: 28, to: 44 },
};

it("shows a standing concern with its age and trend", async () => {
  api.atlasConcerns.mockResolvedValueOnce([CONCERN]);
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText(/still open/i)).toBeTruthy());
  expect(screen.getByText(/airlock/)).toBeTruthy();
  expect(screen.getByText(/6 days/)).toBeTruthy();
  expect(screen.getByText(/28/)).toBeTruthy();
});

it("shows nothing at all when no concern is open", async () => {
  api.atlasConcerns.mockResolvedValueOnce([]);
  render(<AtlasPanel />);
  await waitFor(() => expect(api.atlasConcerns).toHaveBeenCalled());
  expect(screen.queryByText(/still open/i)).toBeNull();
});

it("hands a concern to the chat when you ask it to look into one", async () => {
  // Tier 2: the concern is an ENTRY POINT, not prose. Clicking must switch to
  // the chat and carry enough context that Atlas knows which one was meant.
  api.atlasConcerns.mockResolvedValueOnce([CONCERN]);
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText(/still open/i)).toBeTruthy());
  screen.getByRole("button", { name: /look into this/i }).click();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Debrief" })).toBeTruthy(),
  );
  await waitFor(() => expect(api.atlasSend).toHaveBeenCalled());
  const sent = String(api.atlasSend.mock.calls[0]?.[0] ?? "");
  expect(sent).toContain("no remote");
  expect(sent).toContain("airlock");
});

it("asks again when you click the SAME concern twice", async () => {
  // The handed-in question is keyed on a nonce, not its text. Keying on text
  // would silently swallow the second click; keying on the object identity
  // would fire an extra Opus run on any parent re-render.
  api.atlasConcerns.mockResolvedValueOnce([CONCERN]);
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText(/still open/i)).toBeTruthy());
  screen.getByRole("button", { name: /look into this/i }).click();
  await waitFor(() => expect(api.atlasSend).toHaveBeenCalledTimes(1));

  // Back to the debrief, then ask about the same one again.
  screen.getByRole("button", { name: "Debrief" }).click();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /look into this/i }),
    ).toBeTruthy(),
  );
  screen.getByRole("button", { name: /look into this/i }).click();
  await waitFor(() => expect(api.atlasSend).toHaveBeenCalledTimes(2));
});
