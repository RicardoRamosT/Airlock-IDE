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
import { ExtensionsTab } from "./ExtensionsTab";

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
  expect(await within(listEl).findByText("Slack")).toBeTruthy();
  expect(within(listEl).getByText("Vercel")).toBeTruthy();
  expect(within(listEl).getByText("Connected")).toBeTruthy();
  expect(within(listEl).getByText("Not installed")).toBeTruthy();
});

it("opens on the first CONNECTED extension", async () => {
  legacyList.mockResolvedValue(SUMMARIES);
  render(<ExtensionsTab />);
  // The detail header names the bound account.
  expect(await screen.findByText(/Airlock/)).toBeTruthy();
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
    extensionsResourcesFor: vi.fn(async () => resources),
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
it("shows the selected extension's resources", async () => {
  mount(
    [SLACK],
    [{ id: "c1", title: "#general", subtitle: "12 members", state: "done" }],
  );
  await selectRow("Slack");
  expect(await screen.findByText("#general")).toBeTruthy();
});
