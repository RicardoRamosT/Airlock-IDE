// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ATLAS_STANDING_DEFAULT,
  ATLAS_STANDING_MIN,
} from "../lib/atlasStandingResize";
import { AtlasPanel } from "./AtlasPanel";

afterEach(cleanup);

// A LIST, not one slot: AtlasPanel and the AtlasChat it hosts both subscribe,
// and a single slot silently modelled only whichever mounted last.
let refreshCbs: (() => void)[] = [];
const fireRefresh = () => {
  for (const cb of [...refreshCbs]) cb();
};

// The header is a tablist now, so "which view am I on" is asserted directly
// from aria-selected instead of inferred from a button labelled with its
// DESTINATION -- which is the ambiguity this redesign removed.
const tab = (name: "Debrief" | "Chat") =>
  screen.getByRole("tab", { name }) as HTMLElement;
const onView = (name: "Debrief" | "Chat") =>
  tab(name).getAttribute("aria-selected") === "true";

const api = {
  atlasState: vi.fn(async () => ({
    acknowledged: true,
    disclosure: "",
    mode: "subscription" as const,
    lastView: "brief" as "brief" | "chat",
    standingHeight: 208,
  })),
  // Return type widened to include null: "no debrief today" is a real state
  // the panel must render alongside any open concerns.
  atlasBrief: vi.fn(
    async (): Promise<{ day: string; text: string } | null> => ({
      day: "2026-08-30",
      text: "YESTERDAY",
    }),
  ),
  atlasSetView: vi.fn(async (_v: "brief" | "chat") => {}),
  atlasConcerns: vi.fn(async () => [] as unknown[]),
  atlasForget: vi.fn(async (_root: string) => true),
  atlasOpenWindow: vi.fn(async () => {}),
  atlasProjects: vi.fn(async () => [] as unknown[]),
  atlasSetProjectEnabled: vi.fn(async () => true),
  atlasSetPrefs: vi.fn(async () => true),
  atlasTurns: vi.fn(async () => [] as { role: string; text: string }[]),
  atlasSend: vi.fn(async (_m: string) => "ok"),
  atlasSessions: vi.fn(async () => []),
  atlasNewChat: vi.fn(async () => {}),
  onAtlasRefresh: (cb: () => void) => {
    refreshCbs.push(cb);
    return () => {
      refreshCbs = refreshCbs.filter((x) => x !== cb);
    };
  },
};

beforeEach(() => {
  refreshCbs = [];
  for (const fn of Object.values(api)) {
    if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
  }
  api.atlasState.mockResolvedValue({
    acknowledged: true,
    disclosure: "",
    mode: "subscription",
    lastView: "brief",
    standingHeight: 208,
  });
  (window as unknown as { airlock: unknown }).airlock = api;
});

it("opens on the debrief when that is the persisted view", async () => {
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText("YESTERDAY")).toBeTruthy());
  // The toggle offers the OTHER view.
  expect(onView("Debrief")).toBe(true);
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
    standingHeight: 208,
  });
  render(<AtlasPanel />);
  await waitFor(() => expect(onView("Chat")).toBe(true));
  expect(screen.queryByText("YESTERDAY")).toBeNull();
});

it("persists the view when the user toggles it", async () => {
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText("YESTERDAY")).toBeTruthy());
  tab("Chat").click();
  await waitFor(() => expect(api.atlasSetView).toHaveBeenCalledWith("chat"));
  tab("Debrief").click();
  await waitFor(() => expect(api.atlasSetView).toHaveBeenCalledWith("brief"));
});

it("does not yank the user back on a REFRESH after they switched view", async () => {
  // load() is also the refresh handler and closes over its initial state, so
  // seeding off a piece of state here would re-apply the stored view on every
  // refresh and pull the user out of the chat mid-sentence.
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText("YESTERDAY")).toBeTruthy());
  tab("Chat").click();
  await waitFor(() => expect(onView("Chat")).toBe(true));

  // A refresh arrives (a new debrief composed, say) while the stored pref still
  // says "brief" because the write is async.
  fireRefresh();
  await waitFor(() => expect(api.atlasState).toHaveBeenCalledTimes(2));
  // Still in the chat.
  expect(onView("Chat")).toBe(true);
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
  // Not a vanished folder: there is something here to FIX, so nothing to
  // forget.
  missingRoot: null,
};

// A project that was renamed away. Its row cannot be fixed, only forgotten.
const GONE = {
  key: "/p/Keyview Track|missing",
  project: "Keyview Track",
  title: "folder is gone from disk",
  detail: "/p/Keyview Track was in the registry but is no longer on disk.",
  ageDays: 14,
  trend: null,
  missingRoot: "/p/Keyview Track",
};

const GONE2 = {
  key: "/p/torque|noremote",
  project: "torque",
  title: "no remote",
  detail: "torque has no remote configured.",
  ageDays: 5,
  trend: null,
  missingRoot: null,
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
  await waitFor(() => expect(onView("Chat")).toBe(true));
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
  tab("Debrief").click();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /look into this/i }),
    ).toBeTruthy(),
  );
  screen.getByRole("button", { name: /look into this/i }).click();
  await waitFor(() => expect(api.atlasSend).toHaveBeenCalledTimes(2));
});

it("offers to forget a project whose folder is gone", async () => {
  // The one concern the user resolves by DELETING rather than by fixing. With
  // no such action the row is permanent: the registry never evicts, so it is
  // re-raised on every refresh forever.
  api.atlasConcerns.mockResolvedValueOnce([GONE]);
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText(/still open/i)).toBeTruthy());

  // And it replaces "Look into this": there is nothing on disk left to look
  // into, so that button would spend an Opus run to answer "it is gone".
  expect(screen.queryByRole("button", { name: /look into this/i })).toBeNull();

  screen.getByRole("button", { name: /forget this project/i }).click();
  await waitFor(() =>
    expect(api.atlasForget).toHaveBeenCalledWith("/p/Keyview Track"),
  );
});

it("offers no forget button for a concern that can be fixed", async () => {
  api.atlasConcerns.mockResolvedValueOnce([CONCERN]);
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText(/still open/i)).toBeTruthy());
  expect(screen.queryByRole("button", { name: /forget/i })).toBeNull();
});

it("drops the row once main says the project is forgotten", async () => {
  // Main broadcasts atlas:refresh after the write, which is what makes the
  // removal visible -- and it must reach the panel that asked, not only the
  // others.
  api.atlasConcerns.mockResolvedValueOnce([GONE]);
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText(/still open/i)).toBeTruthy());
  screen.getByRole("button", { name: /forget this project/i }).click();
  await waitFor(() => expect(api.atlasForget).toHaveBeenCalled());

  fireRefresh(); // atlasConcerns now answers with the default: none
  await waitFor(() => expect(screen.queryByText(/still open/i)).toBeNull());
});

it("SHOWS STANDING CONCERNS BEFORE THE DAY'S DEBRIEF EXISTS", async () => {
  // Concerns are read LIVE, precisely so they do not depend on the brief --
  // and then the JSX hid them inside the `brief !== null` branch. Every
  // morning until the brief is composed (and all day if a compose fails) the
  // whole standing-concerns list was invisible, the forget action with it.
  api.atlasBrief.mockResolvedValueOnce(null);
  api.atlasConcerns.mockResolvedValueOnce([GONE]);
  render(<AtlasPanel />);

  await waitFor(() => expect(screen.getByText(/still open/i)).toBeTruthy());
  // BOTH, not either: there is genuinely no debrief, and there is genuinely
  // something open.
  expect(screen.getByText(/no debrief yet/i)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /forget this project/i }),
  ).toBeTruthy();
});

it("still says nothing when there is neither a debrief nor a concern", async () => {
  api.atlasBrief.mockResolvedValueOnce(null);
  api.atlasConcerns.mockResolvedValueOnce([]);
  render(<AtlasPanel />);
  await waitFor(() => expect(screen.getByText(/no debrief yet/i)).toBeTruthy());
  expect(screen.queryByText(/still open/i)).toBeNull();
});

const proj = (name: string, enabled: boolean, missing = false) => ({
  root: `/p/${name}`,
  name,
  addedAt: 1,
  lastSeenAt: 1,
  missing,
  enabled,
});

it("tells the user Atlas has nothing to watch when nothing is enabled", async () => {
  // Opt-in's failure mode: Atlas working correctly and Atlas unconfigured are
  // indistinguishable from the outside. This is the only thing that separates
  // them, and the migration defaults EVERY existing project to off, so this
  // is what an upgrading user sees first.
  api.atlasProjects.mockResolvedValueOnce([proj("a", false), proj("b", false)]);
  render(<AtlasPanel />);
  await screen.findByText(/does not know which projects to watch/i);
  expect(screen.queryByText(/no debrief yet/i)).toBeNull();
});

it("says 'no debrief yet' once at least one project is enabled", async () => {
  api.atlasBrief.mockResolvedValueOnce(null);
  api.atlasProjects.mockResolvedValueOnce([proj("a", true), proj("b", false)]);
  render(<AtlasPanel />);
  await screen.findByText(/no debrief yet/i);
  expect(screen.queryByText(/does not know which projects/i)).toBeNull();
});

it("does not prompt for setup when Atlas has seen no projects at all", async () => {
  // An empty portfolio fixes itself the moment a project is opened; only a
  // populated-but-all-off portfolio is a dead end.
  api.atlasBrief.mockResolvedValueOnce(null);
  api.atlasProjects.mockResolvedValueOnce([]);
  render(<AtlasPanel />);
  await screen.findByText(/no debrief yet/i);
});

it("reaches settings through the overflow, and toggles a project there", async () => {
  api.atlasProjects.mockResolvedValueOnce([proj("Trackview", false)]);
  render(<AtlasPanel />);
  await screen.findByRole("tab", { name: "Debrief" });

  screen.getByRole("button", { name: "More" }).click();
  (await screen.findByRole("menuitem", { name: "Atlas settings" })).click();

  const sw = await screen.findByRole("switch", { name: "Trackview" });
  expect(sw.getAttribute("aria-checked")).toBe("false");
  sw.click();
  await waitFor(() =>
    expect(api.atlasSetProjectEnabled).toHaveBeenCalledWith(
      "/p/Trackview",
      true,
    ),
  );
});

it("offers Open in a window, which only the menu bar could reach before", async () => {
  render(<AtlasPanel />);
  await screen.findByRole("tab", { name: "Debrief" });
  screen.getByRole("button", { name: "More" }).click();
  (await screen.findByRole("menuitem", { name: "Open in a window" })).click();
  await waitFor(() => expect(api.atlasOpenWindow).toHaveBeenCalled());
});

it("collapses the standing concerns so they cannot bury the debrief", async () => {
  // Eight concerns at three lines each is taller than the panel, which pushed
  // the debrief off the top entirely.
  api.atlasConcerns.mockResolvedValueOnce([GONE, GONE2]);
  const { container } = render(<AtlasPanel />);
  await screen.findByText(/still open/i);
  expect(
    screen.queryAllByRole("button", { name: /look into this/i }).length +
      screen.queryAllByRole("button", { name: /forget this project/i }).length,
  ).toBeGreaterThan(0);

  screen.getByRole("button", { name: /still open/i }).click();
  await waitFor(() =>
    expect(
      screen.queryAllByRole("button", { name: /look into this/i }).length +
        screen.queryAllByRole("button", { name: /forget this project/i })
          .length,
    ).toBe(0),
  );
  // AND it is gone from the DOM, not merely from the accessibility tree.
  // The first version used the `hidden` ATTRIBUTE, which removes an element
  // from the a11y tree but loses to any author `display` rule -- the UA
  // sheet's [hidden]{display:none} is user-agent origin, so .atlas-standing-
  // list kept its display:flex and stayed fully visible. This very test passed
  // throughout, because queryAllByRole honours the attribute. Asserting the
  // accessibility projection alone is exactly what let that ship.
  expect(container.querySelector(".atlas-standing-list")).toBeNull();
  // The header stays, with the count, so nothing silently disappears.
  expect(screen.getByRole("button", { name: /still open/i })).toBeTruthy();
});

it("counts the concerns in the header", async () => {
  api.atlasConcerns.mockResolvedValueOnce([GONE, GONE2]);
  render(<AtlasPanel />);
  const head = await screen.findByRole("button", { name: /still open/i });
  expect(head.textContent).toContain("2");
});

// --- the Still open resize handle -------------------------------------------

const grip = () => screen.getByRole("separator", { name: /still open/i });
const listEl = (c: HTMLElement) =>
  c.querySelector(".atlas-standing-list") as HTMLElement;

// jsdom has no layout, so every rect measures 0 -- which resizeStanding reads
// as "unmeasured", leaving the drag unconstrained. That is what makes the
// arithmetic here assertable at all.
const drag = (from: number, to: number) => {
  fireEvent.mouseDown(grip(), { clientY: from });
  fireEvent.mouseMove(document, { clientY: to });
  fireEvent.mouseUp(document, { clientY: to });
};

it("seeds the Still open list from the persisted height", async () => {
  api.atlasConcerns.mockResolvedValueOnce([CONCERN, GONE]);
  api.atlasState.mockResolvedValue({
    acknowledged: true,
    disclosure: "",
    mode: "subscription",
    lastView: "brief",
    standingHeight: 96,
  });
  const { container } = render(<AtlasPanel />);
  await screen.findByText(/still open/i);
  await waitFor(() => expect(listEl(container).style.height).toBe("96px"));
});

it("drags the divider UP to make the Still open area bigger", async () => {
  api.atlasConcerns.mockResolvedValueOnce([CONCERN, GONE]);
  const { container } = render(<AtlasPanel />);
  await screen.findByText(/still open/i);
  drag(300, 240); // 60px up
  expect(listEl(container).style.height).toBe("268px");
  await waitFor(() =>
    expect(api.atlasSetPrefs).toHaveBeenCalledWith({ standingHeight: 268 }),
  );
});

it("drags the divider DOWN to make it smaller", async () => {
  api.atlasConcerns.mockResolvedValueOnce([CONCERN, GONE]);
  const { container } = render(<AtlasPanel />);
  await screen.findByText(/still open/i);
  drag(300, 400); // 100px down
  expect(listEl(container).style.height).toBe("108px");
});

it("never drags below one whole concern", async () => {
  // The floor the user asked for: "minimum I should be able to fit 1 task".
  api.atlasConcerns.mockResolvedValueOnce([CONCERN, GONE]);
  const { container } = render(<AtlasPanel />);
  await screen.findByText(/still open/i);
  drag(300, 5000);
  expect(listEl(container).style.height).toBe(`${ATLAS_STANDING_MIN}px`);
});

it("resizes from the keyboard, so the handle is not mouse-only", async () => {
  api.atlasConcerns.mockResolvedValueOnce([CONCERN, GONE]);
  const { container } = render(<AtlasPanel />);
  await screen.findByText(/still open/i);
  fireEvent.keyDown(grip(), { key: "ArrowUp" });
  await waitFor(() => expect(listEl(container).style.height).toBe("224px"));
  await waitFor(() =>
    expect(api.atlasSetPrefs).toHaveBeenCalledWith({ standingHeight: 224 }),
  );
});

it("double-click resets the Still open area to its default height", async () => {
  api.atlasConcerns.mockResolvedValueOnce([CONCERN, GONE]);
  const { container } = render(<AtlasPanel />);
  await screen.findByText(/still open/i);
  drag(300, 400);
  expect(listEl(container).style.height).not.toBe(
    `${ATLAS_STANDING_DEFAULT}px`,
  );
  fireEvent.doubleClick(grip());
  await waitFor(() =>
    expect(listEl(container).style.height).toBe(`${ATLAS_STANDING_DEFAULT}px`),
  );
});

it("drops the bottom fade once the area is too short to show one through", async () => {
  // The fade is 18px of an 18px-ish box at the minimum, so a one-row list would
  // read as a rendering fault rather than as a list.
  api.atlasConcerns.mockResolvedValueOnce([CONCERN, GONE]);
  const { container } = render(<AtlasPanel />);
  await screen.findByText(/still open/i);
  expect(listEl(container).className).not.toContain("is-tight");
  drag(300, 5000);
  expect(listEl(container).className).toContain("is-tight");
});

it("offers no resize handle while the concerns are collapsed", async () => {
  // There is no list to resize, and a handle that does nothing is worse than
  // no handle.
  api.atlasConcerns.mockResolvedValueOnce([CONCERN, GONE]);
  render(<AtlasPanel />);
  await screen.findByText(/still open/i);
  expect(screen.queryByRole("separator", { name: /still open/i })).toBeTruthy();
  screen.getByRole("button", { name: /still open/i }).click();
  await waitFor(() =>
    expect(screen.queryByRole("separator", { name: /still open/i })).toBeNull(),
  );
});
