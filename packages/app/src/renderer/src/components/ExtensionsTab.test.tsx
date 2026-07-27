// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExtensionSummary, IntegrationItem } from "../../../shared/ipc";
import { useApp } from "../store";
import {
  ExtensionsTab,
  groupOf,
  noActionsNote,
  statusLine,
} from "./ExtensionsTab";

// --- Pre-existing coverage (from a3251af, the page's "minimal body"): the
// list/grouping/selection shell, which Task 3 does not touch. Kept alongside
// the parity suite below so replacing this file for Task 3 does not silently
// drop this regression coverage.
const legacyList = vi.fn();

beforeEach(() => {
  legacyList.mockReset();
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsList: legacyList,
    // SUMMARIES' Slack row is tier:"connected"/status:"connected", which is
    // now expandable (Task 3 fix round 1 wires up ExtensionResources), so it
    // fetches on select/auto-select even though these tests don't assert on
    // resources -- stub both sources or the effect throws.
    extensionsResourcesFor: vi.fn(async () => []),
    integrationsResources: vi.fn(async () => []),
  };
});

afterEach(() => cleanup());

const SUMMARIES = [
  {
    id: "slack",
    name: "Slack",
    tier: "connected",
    status: "connected",
    enabled: true,
    pinned: false,
    hasConfig: true,
    authKind: "oauth2",
    account: "Airlock",
  },
  {
    id: "vercel",
    name: "Vercel",
    tier: "status",
    status: "absent",
    enabled: true,
    pinned: false,
    hasConfig: false,
    authKind: "token",
  },
] as unknown as ExtensionSummary[];

it("groups extensions and shows FULL names (no truncation)", async () => {
  legacyList.mockResolvedValue(SUMMARIES);
  const { container } = render(<ExtensionsTab />);
  // Scope to the list: the selected extension's name also appears as the
  // detail-pane title, so an unscoped query is ambiguous by design.
  const listEl = container.querySelector(".ext-page-list") as HTMLElement;
  // The account rides beside the name, as it did in the sidebar hub.
  expect(await within(listEl).findByText("Slack · Airlock")).toBeTruthy();
  expect(within(listEl).getByText("Vercel")).toBeTruthy();
  expect(within(listEl).getByText("Connected")).toBeTruthy();
  expect(within(listEl).getByText("Not installed")).toBeTruthy();
});

it("opens on the first CONNECTED extension", async () => {
  legacyList.mockResolvedValue(SUMMARIES);
  const { container } = render(<ExtensionsTab />);
  expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe(
    "Slack",
  );
  // The detail state line names the bound account. Scoped to the detail pane:
  // the list row shows it too, so an unscoped /Airlock/ matches twice.
  const detail = container.querySelector(".ext-page-detail") as HTMLElement;
  expect(within(detail).getByText(/Connected · Airlock/)).toBeTruthy();
});

it("switches the detail pane when another extension is picked", async () => {
  legacyList.mockResolvedValue(SUMMARIES);
  render(<ExtensionsTab />);
  const listEl2 = document.querySelector(".ext-page-list") as HTMLElement;
  fireEvent.click(await within(listEl2).findByText("Vercel"));
  expect(screen.getByText(/is not installed/i)).toBeTruthy();
});

it("prompts to choose when there are no extensions at all", async () => {
  legacyList.mockResolvedValue([]);
  render(<ExtensionsTab />);
  expect(await screen.findByText(/Choose an extension/i)).toBeTruthy();
});

// --- Task 3 parity gate: the detail pane renders and wires every action ---
let list: ReturnType<typeof vi.fn>;
let disconnect: ReturnType<typeof vi.fn>;
let prefsSet: ReturnType<typeof vi.fn>;
// Pinned to the store's own signature: bare `ReturnType<typeof vi.fn>` (as for
// the mocks above) infers a Procedure|Constructable UNION whose construct-only
// branch has no call signature, so it fails to satisfy useApp.setState's
// strictly-typed `runInNewTerminal: (command: string) => void` -- the other
// three mocks above dodge this only because they land in a `Record<string,
// unknown>`-typed window.airlock, which erases the check.
let runInNewTerminal: ReturnType<typeof vi.fn<(command: string) => void>>;
let resourcesFor: ReturnType<typeof vi.fn>;

const SLACK: ExtensionSummary = {
  id: "slack",
  name: "Slack",
  tier: "connected",
  status: "connected",
  enabled: true,
  pinned: false,
  hasConfig: true,
  authKind: "oauth2",
  category: "activity",
  actions: [
    { kind: "changeWorkspace", label: "Change Slack workspace" },
    { kind: "configure", label: "Configure Slack" },
    { kind: "disconnect", label: "Disconnect Slack", danger: true },
  ],
};

const SNOWFLAKE: ExtensionSummary = {
  id: "snowflake",
  name: "Snowflake",
  tier: "status",
  status: "absent",
  enabled: true,
  pinned: false,
  hasConfig: false,
  authKind: "token",
  category: "databases",
  actions: [
    {
      kind: "install",
      label: "Install Snowflake",
      command: "brew install snowflake-cli",
    },
  ],
};

// `resources` seeds extensionsResourcesFor's resolved value (default: none) --
// only the one resource-list test below needs a non-empty return.
function mount(rows: ExtensionSummary[], resources: IntegrationItem[] = []) {
  list = vi.fn(async () => rows);
  disconnect = vi.fn(async () => ({ ok: true }));
  prefsSet = vi.fn(async () => ({}));
  runInNewTerminal = vi.fn<(command: string) => void>();
  resourcesFor = vi.fn(async () => resources);
  // A root is required: Disconnect is root-scoped, and without one the button
  // silently does nothing and the assertion below would never fire.
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    modal: null,
    extensionsPrefs: {},
    runInNewTerminal,
    activeTabId: t1,
    tabState: {
      ...useApp.getState().tabState,
      [t1]: { root: "/proj" } as never,
    },
  });
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsList: list,
    extensionsDisconnect: disconnect,
    prefsSet,
    extensionsResourcesFor: resourcesFor,
    integrationsResources: vi.fn(async () => []),
  };
  return render(<ExtensionsTab />);
}

// Every fixture below mounts a single row, and ExtensionsTab auto-selects it
// on load (first CONNECTED, else the first row -- see groupOf's caller). So by
// the time the row's name would resolve via an unscoped query, it is already
// showing a SECOND time as the detail pane's <h2> title, and
// screen.findByText throws "Found multiple elements" rather than picking one.
// The list's own pre-existing tests hit this same ambiguity (see the
// "Scope to the list" comment above) and scope to `.ext-page-list` for
// exactly this reason; do the same here to select the row rather than to
// assert on it.
async function selectRow(name: string) {
  const listEl = document.querySelector(".ext-page-list") as HTMLElement;
  fireEvent.click(await within(listEl).findByText(name));
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  useApp.setState({ modal: null });
});

// Selecting a row is all the page could do before; these are the eight actions
// the 260px sidebar carried and the page must carry before it replaces it.
it("opens the OAuth modal from Change workspace", async () => {
  mount([SLACK]);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByText("Change Slack workspace"));
  });
  expect(useApp.getState().modal).toEqual({
    oauthDevice: { id: "slack", name: "Slack", manage: true },
  });
});

it("opens the channel allow-list from Configure", async () => {
  mount([SLACK]);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByText("Configure Slack"));
  });
  expect(useApp.getState().modal).toBe("slack-channels");
});

it("removes the vaulted token from Disconnect", async () => {
  mount([SLACK]);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByText("Disconnect Slack"));
  });
  expect(disconnect).toHaveBeenCalledWith("/proj", "slack");
});

it("runs an install command in a new terminal rather than auto-running it", async () => {
  mount([SNOWFLAKE]);
  await selectRow("Snowflake");
  await act(async () => {
    fireEvent.click(screen.getByText("Install Snowflake"));
  });
  expect(runInNewTerminal).toHaveBeenCalledWith("brew install snowflake-cli");
});

it("opens the browser login for an unauthed oauth2 extension", async () => {
  mount([
    {
      ...SLACK,
      status: "unauthed",
      actions: [{ kind: "connectOauth", label: "Connect Slack" }],
    },
  ]);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByText("Connect Slack"));
  });
  expect(useApp.getState().modal).toEqual({
    oauthDevice: { id: "slack", name: "Slack" },
  });
});

it("toggles enable through prefs", async () => {
  mount([SLACK]);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Enable Slack"));
  });
  expect(prefsSet).toHaveBeenCalledWith({
    extensions: { slack: { enabled: false } },
  });
});

it("toggles pin through prefs, naming the section it surfaces into", async () => {
  mount([SLACK]);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Show Slack in activity"));
  });
  expect(prefsSet).toHaveBeenCalledWith({
    extensions: { slack: { pinned: true } },
  });
});

it("offers no pin control for an extension with no target section", async () => {
  // category undefined => the eye has nowhere to surface it.
  mount([{ ...SLACK, category: undefined }]);
  await selectRow("Slack");
  expect(screen.queryByLabelText(/Show Slack in/)).toBeNull();
});

it("says so plainly when a row has nothing to act on", async () => {
  mount([{ ...SNOWFLAKE, status: "ready", actions: [] }]);
  await selectRow("Snowflake");
  expect(screen.getByText(/nothing to configure/i)).toBeTruthy();
});

// Fix round 1: the sidebar's expand-a-row resource list (ExtensionResources,
// lifted to its own file) has no equivalent on the page unless it is rendered
// here too -- otherwise deleting the sidebar deletes the only place a user
// could see what Claude can read through a connected extension.
const CHANNELS: IntegrationItem[] = [
  { id: "c1", title: "#general", subtitle: "12 members", state: "done" },
];

it("shows the selected extension's resources once expanded", async () => {
  mount([SLACK], CHANNELS);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Expand Slack resources"));
  });
  expect(await screen.findByText("#general")).toBeTruthy();
});

// ExtensionResources polls every 5s while MOUNTED -- for GitHub that is a live
// api.github.com request PLUS a keychain read, every 5 seconds. Auto-selecting
// a connected row on load must therefore NOT mount it: nothing may fetch until
// the user asks, which is the contract the sidebar hub's chevron had.
it("fetches no resources until the user expands them", async () => {
  mount([SLACK], CHANNELS);
  await selectRow("Slack");
  expect(screen.queryByText("#general")).toBeNull();
  expect(resourcesFor).not.toHaveBeenCalled();
});

it("collapses again -- and stops polling -- on a second click", async () => {
  mount([SLACK], CHANNELS);
  await selectRow("Slack");
  const toggle = () =>
    screen.getByLabelText(/(Expand|Collapse) Slack resources/);
  await act(async () => {
    fireEvent.click(toggle());
  });
  expect(await screen.findByText("#general")).toBeTruthy();
  await act(async () => {
    fireEvent.click(toggle());
  });
  expect(screen.queryByText("#general")).toBeNull();
});

it("offers no expander on a row with no resources to show", async () => {
  // An absent Tier-1 row has nothing granted, so there is nothing to poll for.
  mount([SNOWFLAKE]);
  await selectRow("Snowflake");
  expect(screen.queryByLabelText(/Snowflake resources/)).toBeNull();
});

// Revisiting a row must not silently resume its 5s poll. The first version of
// this test asserted `queryByText("#general")` was null right after the
// round-trip -- which passes even when the list HAS remounted, because
// ExtensionResources renders "Loading..." until its fetch resolves. It passed on
// timing, not on correctness. Assert the toggle's ACCESSIBLE STATE (which cannot
// be faked by an in-flight fetch) and that the fetch count did not move, with a
// microtask flush in between so a resumed fetch would have landed.
it("collapses the resource list -- and does not refetch -- when the selection round-trips", async () => {
  mount([SLACK, SNOWFLAKE], CHANNELS);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Expand Slack resources"));
  });
  expect(await screen.findByText("#general")).toBeTruthy();
  expect(resourcesFor).toHaveBeenCalledTimes(1);
  await selectRow("Snowflake");
  await selectRow("Slack");
  expect(screen.getByLabelText("Expand Slack resources")).toBeTruthy();
  expect(screen.queryByLabelText("Collapse Slack resources")).toBeNull();
  await act(async () => {});
  expect(resourcesFor).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("#general")).toBeNull();
});

// --- Finding #6: the action kinds are extension-agnostic, the modals are not.
it("does not open Slack's connect modal for another token extension", async () => {
  mount([
    {
      ...SLACK,
      id: "linear",
      name: "Linear",
      status: "unauthed",
      authKind: "token",
      account: undefined,
      actions: [{ kind: "connectToken", label: "Connect Linear" }],
    },
  ]);
  await selectRow("Linear");
  await act(async () => {
    fireEvent.click(screen.getByText("Connect Linear"));
  });
  expect(useApp.getState().modal).toBeNull();
});

it("does not open Slack's channel allow-list for another extension", async () => {
  mount([
    {
      ...SLACK,
      id: "github",
      name: "GitHub",
      account: undefined,
      actions: [{ kind: "configure", label: "Configure GitHub" }],
    },
  ]);
  await selectRow("GitHub");
  await act(async () => {
    fireEvent.click(screen.getByText("Configure GitHub"));
  });
  expect(useApp.getState().modal).toBeNull();
});

// --- Finding #1: the page is the ONLY surface that performs actions, so a
// mounted page that never re-asks shows a stale world until you navigate away.
it("re-polls every 5s so an action's result lands without navigating away", async () => {
  vi.useFakeTimers();
  mount([SLACK]);
  await act(async () => {});
  expect(screen.getByText("Disconnect Slack")).toBeTruthy();
  // Disconnect happened (here, or in another window, or via the CLI).
  list.mockImplementation(async () => [
    {
      ...SLACK,
      status: "unauthed",
      actions: [{ kind: "connectOauth", label: "Connect Slack" }],
    },
  ]);
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.queryByText("Disconnect Slack")).toBeNull();
  expect(screen.getByText("Connect Slack")).toBeTruthy();
  vi.useRealTimers();
});

it("a poll never yanks the selection off the row the user picked", async () => {
  vi.useFakeTimers();
  mount([SLACK, SNOWFLAKE]);
  await act(async () => {});
  // Auto-selected the connected row...
  const title = () =>
    (document.querySelector(".ext-page-title") as HTMLElement).textContent;
  expect(title()).toBe("Slack");
  const listEl = document.querySelector(".ext-page-list") as HTMLElement;
  await act(async () => {
    fireEvent.click(within(listEl).getByText("Snowflake"));
  });
  expect(title()).toBe("Snowflake");
  // ...and three polls later the user's pick is still the one showing.
  await act(async () => {
    vi.advanceTimersByTime(15000);
  });
  expect(list.mock.calls.length).toBeGreaterThan(1);
  expect(title()).toBe("Snowflake");
  vi.useRealTimers();
});

it("re-picks a selection when the selected extension disappears", async () => {
  vi.useFakeTimers();
  mount([SLACK, SNOWFLAKE]);
  await act(async () => {});
  const title = () =>
    (document.querySelector(".ext-page-title") as HTMLElement).textContent;
  expect(title()).toBe("Slack");
  list.mockImplementation(async () => [SNOWFLAKE]);
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(title()).toBe("Snowflake");
  vi.useRealTimers();
});

it("stops polling on unmount", async () => {
  vi.useFakeTimers();
  const { unmount } = mount([SLACK]);
  await act(async () => {});
  const after = list.mock.calls.length;
  unmount();
  await act(async () => {
    vi.advanceTimersByTime(20000);
  });
  expect(list.mock.calls.length).toBe(after);
  vi.useRealTimers();
});

// --- Finding #3: the state readout, not just the buttons. The parity gate was
// scoped to ACTIONS, so three of the six statuses displayed something false.

// The list renders only after the first fetch resolves. A row is auto-selected
// in the same commit, so the detail pane's <h2> is the unambiguous thing to
// wait on (group headings and row names are not).
async function waitForList(container: HTMLElement): Promise<HTMLElement> {
  await screen.findByRole("heading", { level: 2 });
  return container.querySelector(".ext-page-list") as HTMLElement;
}

it("buckets a ready Tier-1 CLI as Connected, not Available", async () => {
  const { container } = mount([{ ...SNOWFLAKE, status: "ready", actions: [] }]);
  const listEl = await waitForList(container);
  expect(within(listEl).getByText("Connected")).toBeTruthy();
  expect(within(listEl).queryByText("Available")).toBeNull();
});

it("buckets an errored row as Not installed", async () => {
  const { container } = mount([{ ...SNOWFLAKE, status: "error", actions: [] }]);
  const listEl = await waitForList(container);
  expect(within(listEl).getByText("Not installed")).toBeTruthy();
});

it("gives a disabled extension its own bucket", async () => {
  const { container } = mount([
    { ...SNOWFLAKE, status: "disabled", enabled: false, actions: [] },
  ]);
  const listEl = await waitForList(container);
  expect(within(listEl).getByText("Disabled")).toBeTruthy();
  expect(within(listEl).queryByText("Not installed")).toBeNull();
});

it("moves a row into Disabled the moment Enabled is unchecked", async () => {
  // The bucket reads the EFFECTIVE enabled state (optimistic pref over the
  // polled row), so it cannot disagree with the checkbox next to it.
  const { container } = mount([SLACK]);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Enable Slack"));
  });
  const listEl = container.querySelector(".ext-page-list") as HTMLElement;
  expect(within(listEl).getByText("Disabled")).toBeTruthy();
  expect(within(listEl).queryByText("Connected")).toBeNull();
});

it("renders a status dot per row so the states are distinguishable", async () => {
  const { container } = mount([
    SLACK, // connected -> on
    { ...SNOWFLAKE, id: "a", name: "A", status: "unauthed" }, // -> running
    { ...SNOWFLAKE, id: "b", name: "B", status: "error" }, // -> fail
    SNOWFLAKE, // absent -> grey
  ]);
  const listEl = await waitForList(container);
  expect(listEl.querySelectorAll(".status-dot").length).toBe(4);
  expect(listEl.querySelectorAll(".status-dot.on").length).toBe(1);
  expect(listEl.querySelectorAll(".status-dot.running").length).toBe(1);
  expect(listEl.querySelectorAll(".status-dot.fail").length).toBe(1);
});

it("tells the truth about a ready row instead of 'not connected'", async () => {
  mount([{ ...SNOWFLAKE, status: "ready", actions: [] }]);
  await selectRow("Snowflake");
  expect(screen.queryByText(/not connected/i)).toBeNull();
  expect(screen.getByText(/Installed and signed in/)).toBeTruthy();
});

it("tells the truth about a disabled row instead of 'ready to use'", async () => {
  mount([{ ...SNOWFLAKE, status: "disabled", enabled: false, actions: [] }]);
  await selectRow("Snowflake");
  expect(screen.queryByText(/ready to use/i)).toBeNull();
  expect(screen.getByText(/is disabled/)).toBeTruthy();
  expect(screen.getByText(/Enable Snowflake to see/)).toBeTruthy();
});

it("tells the truth about an errored row instead of 'ready to use'", async () => {
  mount([{ ...SNOWFLAKE, status: "error", actions: [] }]);
  await selectRow("Snowflake");
  expect(screen.queryByText(/ready to use/i)).toBeNull();
  expect(screen.getByText(/reported an error/)).toBeTruthy();
});

// --- The pure bits, directly.
it("groupOf buckets all six statuses the way the sidebar hub did", () => {
  const of = (status: ExtensionSummary["status"], enabled = true): string =>
    groupOf({ ...SLACK, status, enabled }, enabled);
  // ready = a Tier-1 CLI installed AND logged in: it belongs with Connected.
  expect(of("ready")).toBe("connected");
  expect(of("connected")).toBe("connected");
  expect(of("unauthed")).toBe("available");
  expect(of("absent")).toBe("absent");
  // A failed probe is closer to Not installed than to ready-to-use.
  expect(of("error")).toBe("absent");
  expect(of("disabled", false)).toBe("disabled");
  // Disabled wins over every status: it is what unchecking "Enabled" produces.
  expect(of("connected", false)).toBe("disabled");
  expect(of("ready", false)).toBe("disabled");
  expect(of("absent", false)).toBe("disabled");
});

it("groupOf defaults to the row's own enabled flag", () => {
  expect(groupOf({ ...SLACK, enabled: false })).toBe("disabled");
  expect(groupOf({ ...SLACK, enabled: true })).toBe("connected");
});

it("statusLine says something distinct and true for each status", () => {
  const line = (e: Partial<ExtensionSummary>, enabled = true) =>
    statusLine({ ...SLACK, ...e }, enabled);
  expect(line({ status: "absent", name: "Azure" })).toBe(
    "Azure is not installed.",
  );
  expect(line({ status: "unauthed", tier: "connected" })).toBe(
    "Not connected.",
  );
  expect(line({ status: "unauthed", tier: "status" })).toBe(
    "Installed, not signed in.",
  );
  expect(line({ status: "ready", tier: "status", account: "sub-1" })).toBe(
    "Installed and signed in · sub-1",
  );
  expect(line({ status: "connected", account: "Airlock" })).toBe(
    "Connected · Airlock",
  );
  expect(line({ status: "error", name: "Azure" })).toContain("error");
  expect(line({ status: "disabled", name: "Azure" }, false)).toContain(
    "Azure is disabled",
  );
  // An optimistic un-check reads as disabled even before the poll catches up.
  expect(line({ status: "connected" }, false)).toContain("is disabled");
  // No two statuses share a sentence.
  const all = (
    ["absent", "unauthed", "ready", "connected", "error"] as const
  ).map((status) => line({ status }));
  expect(new Set(all).size).toBe(all.length);
});

it("noActionsNote never claims a disabled or errored row is ready to use", () => {
  expect(noActionsNote({ ...SLACK, status: "ready" }, true)).toContain(
    "ready to use",
  );
  expect(noActionsNote({ ...SLACK, status: "disabled" }, false)).toBe(
    "Enable Slack to see what it offers.",
  );
  expect(noActionsNote({ ...SLACK, status: "error" }, true)).toContain(
    "checked again",
  );
});

// --- CRITICAL #2 (2026-07-27 fix wave): summary.ts's sectionExtensionSummaries
// hands every SECTION_EXTENSIONS row (Docker, Neon, Render, Snowflake, Azure,
// Vercel) a PLACEHOLDER status:"ready" because it deliberately cannot see their
// real liveness -- that lives in their own section. Before this fix, groupOf/
// statusDot/statusLine/noActionsNote switched on status alone, so a user who
// had NEVER installed Docker saw it filed under "Connected" with a green dot
// and "Installed and signed in" / "ready to use" -- actively false. Every
// assertion below FAILS against that pre-fix code (which ignored `tier`
// entirely) and passes once tier === "section" is branched on first.
const DOCKER_SECTION: ExtensionSummary = {
  id: "docker",
  name: "Docker",
  tier: "section",
  status: "ready",
  enabled: true,
  pinned: false,
  hasConfig: false,
  authKind: "token",
  category: "databases",
  icon: "docker",
  actions: [],
};

it("groupOf files a section extension under its own bucket, never Connected", () => {
  expect(groupOf(DOCKER_SECTION)).toBe("section");
  expect(groupOf(DOCKER_SECTION)).not.toBe("connected");
});

it("groupOf still buckets a disabled section extension as Disabled", () => {
  expect(groupOf({ ...DOCKER_SECTION, enabled: false }, false)).toBe(
    "disabled",
  );
});

it("statusLine never tells a section extension it is installed and signed in", () => {
  const line = statusLine(DOCKER_SECTION, true);
  expect(line).not.toMatch(/installed and signed in/i);
  expect(line).toContain("its own section");
});

it("noActionsNote never tells a section extension it is ready to use", () => {
  expect(noActionsNote(DOCKER_SECTION, true)).not.toMatch(/ready to use/i);
});

it("buckets a section extension apart from Connected and never paints its dot green", async () => {
  const { container } = mount([DOCKER_SECTION]);
  const listEl = await waitForList(container);
  // A user who never installed Docker must not see it filed as Connected.
  expect(within(listEl).getByText("Has its own section")).toBeTruthy();
  expect(within(listEl).queryByText("Connected")).toBeNull();
  expect(listEl.querySelectorAll(".status-dot.on").length).toBe(0);
});

it("tells the truth about a section extension in the detail pane too", async () => {
  const { container } = mount([DOCKER_SECTION]);
  await waitForList(container);
  expect(screen.queryByText(/installed and signed in/i)).toBeNull();
  expect(screen.queryByText(/ready to use/i)).toBeNull();
  // Both statusLine and noActionsNote point at "its own section" (by design --
  // neither claims a connection state), so scope to statusLine's exact wording.
  expect(
    screen.getByText(/its own section, where its real state is shown/),
  ).toBeTruthy();
});
