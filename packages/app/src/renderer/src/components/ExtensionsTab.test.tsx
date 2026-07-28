// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExtensionAction,
  ExtensionSummary,
  IntegrationItem,
} from "../../../shared/ipc";
import { useApp } from "../store";
import {
  ExtensionsTab,
  groupOf,
  noActionsNote,
  splitActions,
  statusLine,
} from "./ExtensionsTab";

// --- Pre-existing coverage (from a3251af, the page's "minimal body"): the
// list/grouping/selection shell, which Task 3 does not touch. Kept alongside
// the parity suite below so replacing this file for Task 3 does not silently
// drop this regression coverage.
const legacyList = vi.fn();

beforeEach(() => {
  legacyList.mockReset();
  slackWorkspaces = vi.fn(async () => [] as unknown[]);
  slackBindWorkspace = vi.fn(async () => {});
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsList: legacyList,
    // SUMMARIES' Slack row is tier:"connected"/status:"connected", which is
    // now expandable (Task 3 fix round 1 wires up ExtensionResources), so it
    // fetches on select/auto-select even though these tests don't assert on
    // resources -- stub both sources or the effect throws.
    extensionsResourcesFor: vi.fn(async () => []),
    integrationsResources: vi.fn(async () => []),
    slackWorkspaces,
    slackBindWorkspace,
    // The GitHub pane renders its gh account list; without these the effect
    // throws for any fixture with id "github".
    githubInfo: vi.fn(async () => ({ gh: { installed: true, accounts: [] } })),
    resolveGithubAccount: vi.fn(async () => null),
    setProjectGithubAccount: vi.fn(async () => {}),
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
  render(<ExtensionsTab />);
  // Scope to the list: the selected extension's name also appears as the
  // detail-pane title, so an unscoped query is ambiguous by design.
  const listEl = await listPane();
  // Name and account are SEPARATE spans, not one concatenated string. As one
  // string a long account ("Azure · Azure Subscription (CSP)") wrapped past the
  // row's fixed height and overlapped the row below; split, the name holds its
  // width and the account truncates. Both still render.
  const slackRow = (await within(listEl).findByText("Slack")).closest(
    ".ext-page-row",
  ) as HTMLElement;
  expect(within(slackRow).getByText("Airlock")).toBeTruthy();
  expect(within(listEl).getByText("Vercel")).toBeTruthy();
  expect(within(listEl).getByText("Connected")).toBeTruthy();
  expect(within(listEl).getByText("Not installed")).toBeTruthy();
});

it("opens on the first CONNECTED extension", async () => {
  legacyList.mockResolvedValue(SUMMARIES);
  render(<ExtensionsTab />);
  expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe(
    "Slack",
  );
  // The detail state line names the bound account. Scoped to the detail pane:
  // the list row shows it too, so an unscoped /Airlock/ matches twice.
  const detail = await detailPane();
  expect(within(detail).getByText(/Connected · Airlock/)).toBeTruthy();
});

it("switches the detail pane when another extension is picked", async () => {
  legacyList.mockResolvedValue(SUMMARIES);
  render(<ExtensionsTab />);
  const listEl2 = await listPane();
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
let setProjectUse: ReturnType<typeof vi.fn>;
let prefsSet: ReturnType<typeof vi.fn>;
// Pinned to the store's own signature: bare `ReturnType<typeof vi.fn>` (as for
// the mocks above) infers a Procedure|Constructable UNION whose construct-only
// branch has no call signature, so it fails to satisfy useApp.setState's
// strictly-typed `runInNewTerminal: (command: string) => void` -- the other
// three mocks above dodge this only because they land in a `Record<string,
// unknown>`-typed window.airlock, which erases the check.
let runInNewTerminal: ReturnType<typeof vi.fn<(command: string) => void>>;
let resourcesFor: ReturnType<typeof vi.fn>;
let slackWorkspaces: ReturnType<typeof vi.fn>;
let slackBindWorkspace: ReturnType<typeof vi.fn>;

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
function mount(
  rows: ExtensionSummary[],
  resources: IntegrationItem[] = [],
  // The pooled Slack workspaces. Passed IN rather than set on the mock by the
  // caller: mount() reassigns the mock, so a mockResolvedValue set beforehand
  // would be silently discarded.
  pool: { id: string; name: string; domain: string }[] = [],
) {
  list = vi.fn(async () => rows);
  disconnect = vi.fn(async () => ({ ok: true }));
  prefsSet = vi.fn(async () => ({}));
  runInNewTerminal = vi.fn<(command: string) => void>();
  resourcesFor = vi.fn(async () => resources);
  // Empty pool by default: only the reuse tests seed it.
  slackWorkspaces = vi.fn(async () => pool);
  slackBindWorkspace = vi.fn(async () => {});
  setProjectUse = vi.fn(async () => {});
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
    slackWorkspaces,
    slackBindWorkspace,
    extensionsSetProjectUse: setProjectUse,
    // The GitHub pane renders its gh account list; without these the effect
    // throws for any fixture with id "github".
    githubInfo: vi.fn(async () => ({ gh: { installed: true, accounts: [] } })),
    resolveGithubAccount: vi.fn(async () => null),
    setProjectGithubAccount: vi.fn(async () => {}),
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
// The page renders a spinner until every first-paint fetch has settled, so the
// list pane is NOT in the DOM synchronously after render() any more. Waiting
// for it is the honest equivalent of the old synchronous querySelector -- the
// pane's absence at t=0 is the fix, not a flake.
async function listPane(): Promise<HTMLElement> {
  // Sync path first. Several tests below drive the poll with FAKE timers, and
  // waitFor polls on a real interval -- so calling it there hangs until the
  // suite timeout even though the element is already in the DOM.
  const now = document.querySelector(".ext-page-list");
  if (now) return now as HTMLElement;
  await waitFor(() =>
    expect(document.querySelector(".ext-page-list")).not.toBeNull(),
  );
  return document.querySelector(".ext-page-list") as HTMLElement;
}

async function detailPane(): Promise<HTMLElement> {
  await waitFor(() =>
    expect(document.querySelector(".ext-page-detail")).not.toBeNull(),
  );
  return document.querySelector(".ext-page-detail") as HTMLElement;
}

async function selectRow(name: string) {
  const listEl = await listPane();
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

it("SHOWS the terminal it just started, instead of leaving it behind the page", async () => {
  // Reported from the UI: clicking Connect appeared to do nothing. The command
  // WAS running -- `snow connection add` was sitting at its first prompt -- but
  // the hub is a full-width page rendered in the workspace slot, so the new
  // terminal was created behind it. Surfacing the panes is what makes the
  // button's effect visible at all.
  useApp.setState({ appPage: "extensions" });
  mount([SNOWFLAKE]);
  await selectRow("Snowflake");
  await act(async () => {
    fireEvent.click(screen.getByText("Install Snowflake"));
  });
  expect(useApp.getState().appPage).toBeNull();
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

// Reported from the UI: "Show in host" was off for Render and Azure, and both
// still appeared in Host. The control was not merely broken -- it was orphaned.
// It wrote the `pinned` pref, whose only readers (integrations:steady and
// extensions:resources) lost their renderer callers when Databases and Host
// were rewritten to always-present ProviderRows, so toggling it changed
// nothing anywhere. And it could not be repaired by wiring it back up: rule 1
// of the router is that a provider row is ALWAYS present and always states a
// reason, so a switch that hides one would contradict the design on purpose.
it("offers NO show-in switch, since the routers always show every provider", async () => {
  mount([SLACK]); // category "activity"
  await selectRow("Slack");
  expect(screen.queryByLabelText(/Show Slack in/)).toBeNull();
  expect(screen.queryByText(/^Show in/)).toBeNull();
});

it("never writes the dead `pinned` pref", async () => {
  mount([SLACK]);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Enable Slack"));
  });
  // Enabled still round-trips; pinned is gone from the payload entirely.
  expect(prefsSet).toHaveBeenCalledWith({
    extensions: { slack: { enabled: false } },
  });
  expect(JSON.stringify(prefsSet.mock.calls)).not.toContain("pinned");
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
  const listEl = await listPane();
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
async function waitForList(): Promise<HTMLElement> {
  await screen.findByRole("heading", { level: 2 });
  return await listPane();
}

it("buckets a ready Tier-1 CLI as Connected, not Available", async () => {
  mount([{ ...SNOWFLAKE, status: "ready", actions: [] }]);
  const listEl = await waitForList();
  expect(within(listEl).getByText("Connected")).toBeTruthy();
  expect(within(listEl).queryByText("Available")).toBeNull();
});

it("buckets an errored row as Not installed", async () => {
  mount([{ ...SNOWFLAKE, status: "error", actions: [] }]);
  const listEl = await waitForList();
  expect(within(listEl).getByText("Not installed")).toBeTruthy();
});

it("gives a disabled extension its own bucket", async () => {
  mount([{ ...SNOWFLAKE, status: "disabled", enabled: false, actions: [] }]);
  const listEl = await waitForList();
  expect(within(listEl).getByText("Disabled")).toBeTruthy();
  expect(within(listEl).queryByText("Not installed")).toBeNull();
});

it("moves a row into Disabled the moment Enabled is unchecked", async () => {
  // The bucket reads the EFFECTIVE enabled state (optimistic pref over the
  // polled row), so it cannot disagree with the checkbox next to it.
  mount([SLACK]);
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Enable Slack"));
  });
  const listEl = await listPane();
  expect(within(listEl).getByText("Disabled")).toBeTruthy();
  expect(within(listEl).queryByText("Connected")).toBeNull();
});

it("renders a status dot per row so the states are distinguishable", async () => {
  mount([
    SLACK, // connected -> on
    { ...SNOWFLAKE, id: "a", name: "A", status: "unauthed" }, // -> warn
    { ...SNOWFLAKE, id: "b", name: "B", status: "error" }, // -> fail
    SNOWFLAKE, // absent -> grey
  ]);
  const listEl = await waitForList();
  expect(listEl.querySelectorAll(".status-dot").length).toBe(4);
  expect(listEl.querySelectorAll(".status-dot.on").length).toBe(1);
  expect(listEl.querySelectorAll(".status-dot.warn").length).toBe(1);
  expect(listEl.querySelectorAll(".status-dot.fail").length).toBe(1);
});

it("does NOT paint not-connected the same colour as connected", async () => {
  // Caught on a live screenshot after the bucket rework: unauthed used
  // `.status-dot.running`, whose background is var(--accent) -- the SAME blue
  // as `.on`. The two states differed only by a pulse, which reads as "in
  // progress" (its meaning everywhere else) rather than "not connected". With
  // Neon and Snowflake now correctly reporting unauthed, that put
  // indistinguishable dots on both sides of the Connected / Not connected line.
  mount([
    SLACK, // connected
    { ...SNOWFLAKE, id: "a", name: "A", status: "unauthed" },
  ]);
  const listEl = await waitForList();
  const classes = [...listEl.querySelectorAll(".status-dot")].map(
    (d) => d.className,
  );
  expect(new Set(classes).size).toBe(2);
  expect(classes).not.toContain("status-dot running");
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

// Found while re-checking this file for the 2026-07-27 duplicate-row fix
// (mergeSectionExtensions, agent-core/summary.ts): a Tier-1 manifest with no
// install/connect command declared (Vercel -- only a browser login outside
// AirLock) has no button while absent or unauthed either, and the fallback
// below it would say "ready to use" -- exactly backwards for either state.
// This became directly reachable once the duplicate-row fix made Vercel's
// manifest row (real status: often "absent", since most users lack the
// vercel CLI) the ONLY hub row for it, rather than one of a duplicate pair.
it("noActionsNote never claims an absent or unauthed Tier-1 row is ready to use", () => {
  const absent = noActionsNote(
    { ...SLACK, tier: "status", status: "absent" },
    true,
  );
  const unauthed = noActionsNote(
    { ...SLACK, tier: "status", status: "unauthed" },
    true,
  );
  expect(absent).not.toMatch(/ready to use/i);
  expect(unauthed).not.toMatch(/ready to use/i);
  expect(absent).toBe("Nothing to do here yet.");
  expect(unauthed).toBe("Nothing to do here yet.");
});

// --- Section extensions are bucketed by their REAL connection state.
//
// Two earlier versions of this block were both wrong. First, every surface
// switched on status alone while summary.ts fabricated status:"ready" for
// section rows, so a machine with no Docker showed it "Connected", green,
// "Installed and signed in". The fix for that special-cased tier === "section"
// everywhere and gave it a bucket called "Has its own section" -- honest, but
// it answered a question nobody asks (all extensions have a section) and left
// the hub unable to say anything about Docker at all.
//
// Now main probes the three for real (sectionExtensionStatuses in ide-state.ts)
// and the tier special case is gone. These assertions pin BOTH directions --
// uninstalled is never Connected, and running genuinely is -- which is what
// makes the special case unnecessary rather than merely absent.
const DOCKER_SECTION: ExtensionSummary = {
  id: "docker",
  name: "Docker",
  tier: "section",
  // What main's probe actually reports for a machine with no Docker. This was
  // "ready" while summary.ts fabricated that status for every section row.
  status: "absent",
  enabled: true,
  pinned: false,
  hasConfig: false,
  authKind: "token",
  category: "databases",
  icon: "docker",
  actions: [],
};

it("groupOf files an uninstalled section extension as Not installed, never Connected", () => {
  expect(groupOf(DOCKER_SECTION)).toBe("absent");
  expect(groupOf(DOCKER_SECTION)).not.toBe("connected");
});

it("groupOf files a RUNNING section extension as Connected", () => {
  // The half the placeholder could never express: with a real status, a
  // section extension can be genuinely connected and is bucketed like any
  // other row -- no tier special case in either direction.
  expect(groupOf({ ...DOCKER_SECTION, status: "connected" })).toBe("connected");
});

it("groupOf still buckets a disabled section extension as Disabled", () => {
  expect(groupOf({ ...DOCKER_SECTION, enabled: false }, false)).toBe(
    "disabled",
  );
});

it("statusLine names the real problem instead of pointing at another section", () => {
  const line = statusLine(DOCKER_SECTION, true);
  expect(line).not.toMatch(/installed and signed in/i);
  // The old text was "Docker has its own section, where its real state is
  // shown" -- true, but it made the hub a signpost instead of an answer.
  expect(line).not.toMatch(/its own section/i);
  expect(line).toBe("Docker is not installed.");
});

it("statusLine says a stopped daemon is not connected, NOT 'not signed in'", () => {
  // Docker installed with the daemon down is `unauthed`. The Tier-1 CLI
  // wording would name the wrong problem: there is no sign-in step here.
  expect(statusLine({ ...DOCKER_SECTION, status: "unauthed" }, true)).toBe(
    "Not connected.",
  );
});

it("noActionsNote never tells an uninstalled section extension it is ready to use", () => {
  expect(noActionsNote(DOCKER_SECTION, true)).not.toMatch(/ready to use/i);
});

it("buckets an uninstalled section extension under Not installed with a grey dot", async () => {
  mount([DOCKER_SECTION]);
  const listEl = await waitForList();
  // A user who never installed Docker must not see it filed as Connected...
  expect(within(listEl).getByText("Not installed")).toBeTruthy();
  expect(within(listEl).queryByText("Connected")).toBeNull();
  expect(listEl.querySelectorAll(".status-dot.on").length).toBe(0);
  // ...nor under a bucket named for something every extension has.
  expect(within(listEl).queryByText(/has its own section/i)).toBeNull();
});

it("paints a connected section extension green, under Connected", async () => {
  mount([{ ...DOCKER_SECTION, status: "connected" }]);
  const listEl = await waitForList();
  expect(within(listEl).getByText("Connected")).toBeTruthy();
  expect(listEl.querySelectorAll(".status-dot.on").length).toBe(1);
});

it("states the real reason in the detail pane too", async () => {
  mount([DOCKER_SECTION]);
  await waitForList();
  expect(screen.queryByText(/installed and signed in/i)).toBeNull();
  expect(screen.queryByText(/ready to use/i)).toBeNull();
  expect(screen.getByText("Docker is not installed.")).toBeTruthy();
});

// The whole button rule, as data. It lives outside JSX because the nested
// ternaries this replaced are exactly what made the old sidebar hub
// unmaintainable -- and because a rule in JSX cannot be tested without
// mounting the page.
describe("splitActions", () => {
  const a = (kind: ExtensionAction["kind"], danger?: true): ExtensionAction =>
    ({ kind, label: kind, ...(danger ? { danger } : {}) }) as ExtensionAction;

  it("pulls the destructive action out, wherever it sits in the list", () => {
    const { primary, secondary, danger } = splitActions([
      a("changeWorkspace"),
      a("disconnect", true),
      a("configure"),
    ]);
    expect(primary?.kind).toBe("changeWorkspace");
    expect(secondary.map((x) => x.kind)).toEqual(["configure"]);
    expect(danger.map((x) => x.kind)).toEqual(["disconnect"]);
  });

  it("makes the first remaining action primary and the rest secondary", () => {
    const { primary, secondary } = splitActions([
      a("connectCli"),
      a("openSection"),
    ]);
    expect(primary?.kind).toBe("connectCli");
    expect(secondary.map((x) => x.kind)).toEqual(["openSection"]);
  });

  it("yields no primary when the ONLY action is destructive", () => {
    // Connected GitHub. The pane must fall back to the no-actions note rather
    // than promoting Disconnect to the primary slot.
    const { primary, secondary, danger } = splitActions([
      a("disconnect", true),
    ]);
    expect(primary).toBeNull();
    expect(secondary).toEqual([]);
    expect(danger).toHaveLength(1);
  });

  it("yields three empties for an empty list", () => {
    expect(splitActions([])).toEqual({
      primary: null,
      secondary: [],
      danger: [],
    });
  });

  it("selects by the danger FLAG, not by the disconnect kind", () => {
    // Data-driven, so a future destructive action lands in the footer without
    // anyone editing this function.
    const { primary, danger } = splitActions([a("configure", true)]);
    expect(primary).toBeNull();
    expect(danger.map((x) => x.kind)).toEqual(["configure"]);
  });
});

it("renders exactly ONE primary button, not a row of equally loud ones", async () => {
  // Fails against the pre-change pane, which painted EVERY action
  // `.btn.primary` -- so Slack showed three saturated blues and a red, and
  // nothing indicated which one you actually wanted.
  const { container } = mount([SLACK]);
  await selectRow("Slack");
  const row = container.querySelector(".ext-detail-buttons") as HTMLElement;
  expect(row.querySelectorAll(".btn.primary")).toHaveLength(1);
  expect(within(row).getByText("Change Slack workspace")).toBeTruthy();
  // The secondary action is present but NOT primary.
  const configure = within(row).getByText("Configure Slack");
  expect(configure.className).not.toContain("primary");
});

it("moves the destructive action out of the button row into its own footer", async () => {
  const { container } = mount([SLACK]);
  await selectRow("Slack");
  const row = container.querySelector(".ext-detail-buttons") as HTMLElement;
  expect(within(row).queryByText("Disconnect Slack")).toBeNull();
  const footer = container.querySelector(".ext-detail-danger") as HTMLElement;
  expect(within(footer).getByText("Disconnect Slack")).toBeTruthy();
});

it("still disconnects when the footer button is clicked", async () => {
  // The move must not break the wiring: same run() dispatcher, new location.
  mount([SLACK]);
  await selectRow("Slack");
  fireEvent.click(screen.getByText("Disconnect Slack"));
  expect(disconnect).toHaveBeenCalledWith("/proj", "slack");
});

it("shows the no-actions note AND the footer when disconnect is all there is", async () => {
  // Connected GitHub: nothing to advance, but the pane must not look empty
  // and must still offer the way out.
  const { container } = mount([
    {
      ...SLACK,
      id: "github",
      name: "GitHub",
      hasConfig: false,
      actions: [
        { kind: "disconnect", label: "Disconnect GitHub", danger: true },
      ],
    },
  ]);
  await selectRow("GitHub");
  expect(container.querySelector(".ext-detail-buttons")).toBeNull();
  expect(screen.getByText(/ready to use/i)).toBeTruthy();
  const footer = container.querySelector(".ext-detail-danger") as HTMLElement;
  expect(within(footer).getByText("Disconnect GitHub")).toBeTruthy();
});

it("omits the danger footer entirely when nothing is destructive", async () => {
  const { container } = mount([SNOWFLAKE]);
  await selectRow("Snowflake");
  expect(container.querySelector(".ext-detail-danger")).toBeNull();
});

it("renders the Settings block even when it carries a single toggle", async () => {
  // The SLACK fixture has category "activity"; the REAL Slack has none, which
  // is what made its pane look different from Azure's. Drop it here to
  // reproduce production.
  const { container } = mount([{ ...SLACK, category: undefined }]);
  await selectRow("Slack");
  const settings = container.querySelector(
    ".ext-detail-settings",
  ) as HTMLElement;
  expect(settings).not.toBeNull();
  expect(within(settings).getByText("Settings")).toBeTruthy();
  expect(within(settings).getByLabelText("Enable Slack")).toBeTruthy();
  // No category -> no "Show in" checkbox. A checkbox pointing at no target is
  // dead UI, so it is omitted -- but the BLOCK still stands, so the pane keeps
  // its shape.
  expect(within(settings).queryByText(/^Show in/)).toBeNull();
});

it("keeps the Settings block even though Enabled is now its only control", async () => {
  const { container } = mount([SNOWFLAKE]); // category: "databases"
  await selectRow("Snowflake");
  const settings = container.querySelector(
    ".ext-detail-settings",
  ) as HTMLElement;
  expect(within(settings).getByText("Settings")).toBeTruthy();
  expect(within(settings).getByLabelText("Enable Snowflake")).toBeTruthy();
  expect(within(settings).queryByText("Show in databases")).toBeNull();
});

it("keeps the toggles OUT of the button row", async () => {
  const { container } = mount([SNOWFLAKE]);
  await selectRow("Snowflake");
  const row = container.querySelector(".ext-detail-buttons") as HTMLElement;
  expect(within(row).queryByText("Enabled")).toBeNull();
});

it("tells a CONNECTED section extension where its resources live", async () => {
  // Docker/Neon/Render resources come from bespoke per-extension IPCs that
  // ExtensionResources cannot reach, so before this the slot rendered NOTHING
  // and the pane just ended after the toggles.
  const { container } = mount([
    {
      ...SNOWFLAKE,
      id: "docker",
      name: "Docker",
      tier: "section",
      status: "connected",
      hasSection: true,
      actions: [{ kind: "openSection", label: "Open Docker" }],
    },
  ]);
  await selectRow("Docker");
  expect(
    screen.getByText("Docker's resources are shown in its own section."),
  ).toBeTruthy();
  // No expander: there is no inline list to expand.
  expect(container.querySelector(".ext-detail-expand")).toBeNull();
});

it("tells a NOT-connected extension that resources come later, not to go looking", async () => {
  // Neon is BOTH hasSection AND not connected -- the one place two conditions
  // overlap. Not-connected must win: pointing at a section that currently
  // lists nothing is technically true and useless.
  mount([
    {
      ...SNOWFLAKE,
      id: "neon",
      name: "Neon",
      tier: "section",
      status: "unauthed",
      hasSection: true,
      actions: [{ kind: "openSection", label: "Open Neon" }],
    },
  ]);
  await selectRow("Neon");
  expect(
    screen.getByText("Resources appear once Neon is connected."),
  ).toBeTruthy();
  expect(screen.queryByText(/shown in its own section/)).toBeNull();
});

it("still offers the expander for an extension with a real inline list", async () => {
  const { container } = mount([SLACK]); // connected tier-2 -> expandable
  await selectRow("Slack");
  expect(container.querySelector(".ext-detail-expand")).not.toBeNull();
});

it("does NOT mount the resource list until the expander is clicked", async () => {
  // ExtensionResources polls while mounted (GitHub: an API call plus a
  // keychain read every 5s), so merely selecting a row must not start it.
  mount([SLACK], [{ id: "r1", title: "general", subtitle: "", state: "idle" }]);
  await selectRow("Slack");
  expect(resourcesFor).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Resources"));
  await waitFor(() => expect(resourcesFor).toHaveBeenCalled());
});

// Connect Slack in project A, and project B could only re-do the whole browser
// authorization for a workspace you were already in. The pool makes that
// credential reusable; these pin that the reuse is offered, applied, and never
// applied on its own.
it("offers a one-click reuse button for each pooled workspace", async () => {
  mount(
    [{ ...SLACK, status: "unauthed", actions: [] }],
    [],
    [{ id: "T1", name: "Airlock", domain: "airlock" }],
  );
  await selectRow("Slack");
  expect(await screen.findByText("Use Airlock")).toBeTruthy();
});

it("binds the project when a reuse button is clicked", async () => {
  mount(
    [{ ...SLACK, status: "unauthed", actions: [] }],
    [],
    [{ id: "T1", name: "Airlock", domain: "airlock" }],
  );
  await selectRow("Slack");
  await act(async () => {
    fireEvent.click(await screen.findByText("Use Airlock"));
  });
  expect(slackBindWorkspace).toHaveBeenCalledWith("/proj", "T1");
});

it("offers NO reuse button once the project is already connected", async () => {
  // Otherwise a connected project shows a button to connect to what it is
  // already connected to.
  mount([SLACK], [], [{ id: "T1", name: "Airlock", domain: "airlock" }]); // connected
  await selectRow("Slack");
  expect(screen.queryByText("Use Airlock")).toBeNull();
});

it("makes reuse the PRIMARY action, ahead of connecting a new workspace", async () => {
  const { container } = mount(
    [
      {
        ...SLACK,
        status: "unauthed",
        actions: [{ kind: "connectOauth", label: "Connect Slack" }],
      },
    ],
    [],
    [{ id: "T1", name: "Airlock", domain: "airlock" }],
  );
  await selectRow("Slack");
  await screen.findByText("Use Airlock");
  const row = container.querySelector(".ext-detail-buttons") as HTMLElement;
  expect(row.querySelector(".btn.primary")?.textContent).toBe("Use Airlock");
});

// The per-project opt-in's home. Its counterpart -- the "Use <name> here"
// button on an irrelevant section -- is one-way, so without this the user
// could turn an extension on for a project and never find the way back.
// It sits in the SETTINGS slot beside the app-wide Enabled switch, and the two
// write to different stores (project config vs app prefs), which is why the
// labels have to distinguish them.
describe("per-project use switch", () => {
  it("is off with an explaining note when the project shows no signal", async () => {
    mount([{ ...SNOWFLAKE, projectUse: "none" }]);
    await selectRow("Snowflake");
    const sw = screen.getByLabelText(
      "Use Snowflake in this project",
    ) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(screen.getByText("Not detected in this project.")).toBeTruthy();
  });

  it("writes the opt-in for the focused project when turned on", async () => {
    mount([{ ...SNOWFLAKE, projectUse: "none" }]);
    await selectRow("Snowflake");
    fireEvent.click(screen.getByLabelText("Use Snowflake in this project"));
    await waitFor(() =>
      expect(setProjectUse).toHaveBeenCalledWith("/proj", "snowflake", true),
    );
  });

  it("is on and reversible when only the explicit opt-in applies", async () => {
    mount([{ ...SNOWFLAKE, projectUse: "optedIn" }]);
    await selectRow("Snowflake");
    const sw = screen.getByLabelText(
      "Use Snowflake in this project",
    ) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    expect(
      screen.getByText("Shown here because you turned it on."),
    ).toBeTruthy();
    fireEvent.click(sw);
    await waitFor(() =>
      expect(setProjectUse).toHaveBeenCalledWith("/proj", "snowflake", false),
    );
  });

  // A signal already makes the project relevant, so turning the override off
  // would hide NOTHING. An interactive switch there is the "Show in {category}"
  // mistake again: a control that visibly does nothing.
  it("is on and NOT interactive when the project's own signal applies", async () => {
    mount([{ ...SNOWFLAKE, projectUse: "signal" }]);
    await selectRow("Snowflake");
    const sw = screen.getByLabelText(
      "Use Snowflake in this project",
    ) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    expect(sw.disabled).toBe(true);
    fireEvent.click(sw);
    expect(setProjectUse).not.toHaveBeenCalled();
  });

  // Slack, GitHub, Docker, Neon, Render: no relevance spec, so they are never
  // irrelevant and the question does not apply to them.
  it("is absent for an extension that cannot be irrelevant", async () => {
    mount([SLACK]);
    await selectRow("Slack");
    expect(screen.queryByLabelText(/in this project/)).toBeNull();
  });
});

// The page used to initialise `all` to [] and paint "Choose an extension from
// the list." with empty buckets -- a confident, WRONG answer -- while
// extensions:list spawned `az account show` and `snow connection test`, each
// with an 8s timeout on a cold cache. Nothing on screen said otherwise, which
// is what read as the app being frozen.
describe("loading state", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("shows a loading indicator instead of an empty-looking page, then the content", async () => {
    const d = deferred<ExtensionSummary[]>();
    mount([]);
    list.mockReturnValue(d.promise);
    cleanup();
    render(<ExtensionsTab />);

    // The bug: this is the finished-looking answer that used to show here.
    expect(screen.queryByText(/Choose an extension/i)).toBeNull();
    expect(await screen.findByRole("status")).toBeTruthy();

    d.resolve([SNOWFLAKE]);
    const listEl = await listPane();
    expect(await within(listEl).findByText("Snowflake")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // THE regression guard. The page polls every 5s; if a refresh reset state to
  // "not asked yet", the spinner would flash every five seconds forever. A
  // refresh must swap content silently.
  it("does not return to loading when a later poll is in flight", async () => {
    mount([SNOWFLAKE]);
    const listEl = await listPane();
    await within(listEl).findByText("Snowflake");

    // A second fetch that never settles stands in for "a poll is in flight".
    list.mockReturnValue(deferred<ExtensionSummary[]>().promise);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(within(listEl).getByText("Snowflake")).toBeTruthy();
  });
});
