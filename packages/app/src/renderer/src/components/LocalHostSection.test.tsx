// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { LocalHostSection } from "./LocalHostSection";

afterEach(cleanup);

// Stub the window.airlock host/dev-server surface LocalHostSection queries on
// mount so it lands in the explicit-devUrl tier: a configured URL, a
// down/up probe, and "nothing else here" (no detected/unverified/managed).
// `services` seeds the Render provider row (the "from your extensions" block,
// fetched independently of the dev-server probe above); defaults to none.
// `azure` stubs integrations:resources("azure") the same way -- a
// SteadyIntegration-shaped {status, resources}, or null (absent, the default).
function stubHost(opts: {
  url: string | null;
  up: boolean;
  services?: unknown[];
  azure?: unknown;
}) {
  const devServerStart = vi.fn(() =>
    Promise.resolve({ ok: true as const, state: {} }),
  );
  const hostOpenExternal = vi.fn();
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    hostLocalUrl: vi.fn(() => Promise.resolve(opts.url)),
    hostProbe: vi.fn(() => Promise.resolve({ up: opts.up })),
    devServerDetectUnmanaged: vi.fn(() => Promise.resolve(null)),
    hostUnverifiedServers: vi.fn(() => Promise.resolve([])),
    devServerStatus: vi.fn(() => Promise.resolve(null)),
    onDevServerChanged: vi.fn(() => () => {}),
    devServerStart,
    hostOpenExternal,
    renderServices: vi.fn(() => Promise.resolve(opts.services ?? [])),
    integrationsResources: vi.fn(() => Promise.resolve(opts.azure ?? null)),
  };
  return { devServerStart, hostOpenExternal };
}

// useProjectTab() falls back to activeTabId with no provider; LocalHostSection
// reads tabState[tabId].root.
function seedRoot() {
  useApp.setState({
    activeTabId: "t1",
    tabState: { t1: { root: "/fake/root" } } as never,
  });
}

it("shows a Start button on a down dev-URL host and wires it to start", async () => {
  const { devServerStart } = stubHost({
    url: "http://localhost:3004",
    up: false,
  });
  seedRoot();
  render(<LocalHostSection />);
  // The URL row appears once the async probe resolves.
  expect(await screen.findByText("http://localhost:3004")).toBeTruthy();
  const start = await screen.findByRole("button", { name: "Start" });
  fireEvent.click(start);
  expect(devServerStart).toHaveBeenCalledWith("/fake/root");
});

it("shows a Start button on an unverified server and wires it to start", async () => {
  const devServerStart = vi.fn(() =>
    Promise.resolve({ ok: true as const, state: {} }),
  );
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    hostLocalUrl: vi.fn(() => Promise.resolve(null)),
    hostProbe: vi.fn(() => Promise.resolve({ up: false })),
    devServerDetectUnmanaged: vi.fn(() => Promise.resolve(null)),
    hostUnverifiedServers: vi.fn(() => Promise.resolve([3000])),
    devServerStatus: vi.fn(() => Promise.resolve(null)),
    onDevServerChanged: vi.fn(() => () => {}),
    devServerStart,
    hostOpenExternal: vi.fn(),
    renderServices: vi.fn(() => Promise.resolve([])),
    integrationsResources: vi.fn(() => Promise.resolve(null)),
  };
  seedRoot();
  render(<LocalHostSection />);
  // The unverified row renders once the async scan resolves.
  expect(await screen.findByText(/· unverified/)).toBeTruthy();
  const start = await screen.findByRole("button", { name: "Start" });
  fireEvent.click(start);
  expect(devServerStart).toHaveBeenCalledWith("/fake/root");
});

it("shows no Start button when the dev-URL host is reachable", async () => {
  stubHost({ url: "http://localhost:3004", up: true });
  seedRoot();
  const { container } = render(<LocalHostSection />);
  // Wait until the probe result (up === true) is applied — the dot goes
  // ".status-dot on" — so we assert against the reachable state, not the
  // transient mid-probe null (which would also lack the button).
  await waitFor(() =>
    expect(container.querySelector(".status-dot.on")).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
});

// The "from your extensions" block: same rule as Databases -- Render and
// Azure are ALWAYS listed, connected or not, each with a true reason. This
// holds regardless of which dev-server branch above is showing.
it("lists Render and Azure as providers, with a reason each", async () => {
  stubHost({ url: null, up: false });
  seedRoot();
  render(<LocalHostSection />);
  expect(await screen.findByText("Render")).toBeTruthy();
  expect(screen.getByText("Azure")).toBeTruthy();
  // Render has no services -- a true reason, not a blank row. `find`, not
  // `get`: the row's NAME and its STATE text resolve from independent
  // promises, so awaiting the name above does not guarantee the state has
  // landed. As a sync get this flaked under full-suite parallel load.
  expect(await screen.findByText("not connected")).toBeTruthy();
  // Azure is redirect-only (its live state lives in its own section), but its
  // state text is real: the default stub resolves absent -> "CLI not found".
  expect(await screen.findByText("CLI not found")).toBeTruthy();
});

// Finding #4 (2026-07-27 fix wave): Azure's provider-row state used to be the
// fixed string "open for web apps", regardless of whether the CLI was even
// installed. It must now be derived from the same real data ext:azure shows --
// these assertions each FAIL against that old hardcoded string.
it("derives Azure's state from its real detect status and resource count", async () => {
  stubHost({
    url: null,
    up: false,
    azure: { status: "ready", resources: [{}, {}] },
  });
  seedRoot();
  render(<LocalHostSection />);
  expect(await screen.findByText("2 web apps")).toBeTruthy();
  expect(screen.queryByText("open for web apps")).toBeNull();
});

it("says Azure is not signed in rather than a fixed string", async () => {
  stubHost({ url: null, up: false, azure: { status: "unauthed" } });
  seedRoot();
  render(<LocalHostSection />);
  expect(await screen.findByText("not signed in")).toBeTruthy();
});

// `az webapp list` is account-wide, so in a project that does not use Azure
// the count is ANOTHER project's web apps. The row stays (rule 1: a provider
// row is always present and always states a reason) but the reason changes.
// "0 web apps" would be the failure this replaced: a correct-looking empty
// answer that does not say WHY -- and it is what the ternary chain renders if
// the irrelevant arm is missing, which TypeScript cannot catch.
it("says Azure is not used in this project rather than counting another project's web apps", async () => {
  stubHost({
    url: null,
    up: false,
    azure: { status: "irrelevant", resources: [] },
  });
  seedRoot();
  render(<LocalHostSection />);
  expect(await screen.findByText("not used in this project")).toBeTruthy();
  expect(screen.queryByText("0 web apps")).toBeNull();
  expect(screen.getByText("Azure")).toBeTruthy(); // the row itself never disappears
});

// The Host row belongs to one project, so it must opt into the project scope.
// Without this the gate in the handler never runs and the leak stays.
it("asks integrations:resources for the PROJECT scope, not the account-wide list", async () => {
  stubHost({ url: null, up: false });
  seedRoot();
  render(<LocalHostSection />);
  const api = (
    window as unknown as {
      airlock: { integrationsResources: ReturnType<typeof vi.fn> };
    }
  ).airlock;
  await waitFor(() =>
    expect(api.integrationsResources).toHaveBeenCalledWith("azure", true),
  );
});

it("gives a Render instance an Open action to its service URL, not Connect", async () => {
  const { hostOpenExternal } = stubHost({
    url: null,
    up: false,
    services: [
      {
        id: "srv-1",
        name: "my-api",
        url: "https://my-api.onrender.com",
        deployStatus: "live",
      },
    ],
  });
  seedRoot();
  render(<LocalHostSection />);
  expect(await screen.findByText("my-api")).toBeTruthy();
  expect(screen.getByText("live")).toBeTruthy();
  // Host answers "what is running", not "what can I query" -- Open, never
  // Connect (that verb is Databases').
  expect(screen.queryByText("Connect")).toBeNull();
  const open = screen.getByRole("button", { name: "Open" });
  fireEvent.click(open);
  expect(hostOpenExternal).toHaveBeenCalledWith("https://my-api.onrender.com");
});

// Same fix as Databases: the Host pane used to paint its dev-server tier and
// provider rows while the Render call and the 8s Azure probe were still out.
describe("loading state", () => {
  it("shows a loading indicator until every first-paint fetch has settled", async () => {
    (window as unknown as { airlock: Record<string, unknown> }).airlock = {
      hostLocalUrl: vi.fn(() => Promise.resolve(null)),
      hostProbe: vi.fn(() => Promise.resolve({ up: false })),
      devServerDetectUnmanaged: vi.fn(() => Promise.resolve(null)),
      hostUnverifiedServers: vi.fn(() => Promise.resolve([])),
      devServerStatus: vi.fn(() => Promise.resolve(null)),
      onDevServerChanged: vi.fn(() => () => {}),
      devServerStart: vi.fn(),
      hostOpenExternal: vi.fn(),
      renderServices: vi.fn(() => Promise.resolve([])),
      // Azure never answers -- the pane must not commit to a picture without it.
      integrationsResources: vi.fn(() => new Promise<never>(() => {})),
    };
    seedRoot();
    render(<LocalHostSection />);
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByText("Azure")).toBeNull();
    expect(screen.queryByText("Render")).toBeNull();
  });

  it("renders the pane once everything has settled", async () => {
    stubHost({ url: null, up: false, azure: { status: "absent" } });
    seedRoot();
    render(<LocalHostSection />);
    expect(await screen.findByText("Azure")).toBeTruthy();
    expect(screen.getByText("Render")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
