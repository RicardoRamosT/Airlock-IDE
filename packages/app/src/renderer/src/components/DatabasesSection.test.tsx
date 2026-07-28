// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { DatabasesSection } from "./DatabasesSection";

afterEach(cleanup);

// useProjectTab() falls back to activeTabId with no provider; DatabasesSection
// reads tabState[tabId].root and early-returns <OpenFolderEmpty /> when it is
// null -- so a root must be seeded before mount, same as LocalHostSection.test.tsx.
function seedRoot() {
  useApp.setState({
    activeTabId: "t1",
    tabState: { t1: { root: "/fake/root" } } as never,
  });
}

// `snowflake` stubs integrations:resources("snowflake") -- SteadyIntegration
// shaped ({status, resources}), or null (absent/unavailable, the default).
function mount(
  dbContainers: unknown[] = [],
  dbs: unknown[] = [],
  snowflake: unknown = null,
) {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    dbList: vi.fn(async () => dbs),
    dockerDatabases: vi.fn(async () => dbContainers),
    neonStatus: vi.fn(async () => ({ connected: false })),
    integrationsResources: vi.fn(async () => snowflake),
  };
  seedRoot();
  return render(<DatabasesSection />);
}

it("shows a provider row for every database extension, connected or not", async () => {
  mount();
  // All three are always listed -- the row's job is to say WHY it is empty.
  expect(await screen.findByText("Neon")).toBeTruthy();
  expect(screen.getByText("Docker")).toBeTruthy();
  expect(screen.getByText("Snowflake")).toBeTruthy();
});

it("lists a Postgres container as a connectable instance", async () => {
  mount([
    {
      id: "c1",
      name: "myapp-db",
      image: "postgres:16",
      engine: "postgres",
      hostPort: 5432,
    },
  ]);
  expect(await screen.findByText("myapp-db")).toBeTruthy();
  expect(screen.getByText(/postgres:16/)).toBeTruthy();
});

it("offers no Connect for a container that publishes no port", async () => {
  // Unreachable from the host -- a Connect that cannot work is worse than none.
  mount([
    {
      id: "c2",
      name: "internal-db",
      image: "postgres:16",
      engine: "postgres",
      hostPort: null,
    },
  ]);
  await screen.findByText("internal-db");
  expect(screen.queryByText("Connect")).toBeNull();
});

// Finding #4 (2026-07-27 fix wave): Snowflake's provider-row state used to be
// the fixed string "open for warehouses", regardless of whether the CLI was
// even installed. It must now be derived from the same real data ext:snowflake
// shows -- these three assertions each FAIL against that old hardcoded string.
it("derives Snowflake's state from its real detect status and resource count", async () => {
  mount([], [], { status: "ready", resources: [{}, {}, {}] });
  expect(await screen.findByText("3 warehouses")).toBeTruthy();
  expect(screen.queryByText("open for warehouses")).toBeNull();
});

it("says Snowflake is not signed in rather than a fixed string", async () => {
  mount([], [], { status: "unauthed", resources: [] });
  expect(await screen.findByText("not signed in")).toBeTruthy();
});

it("says Snowflake's CLI is not found when absent, rather than a fixed string", async () => {
  mount([], [], { status: "absent", resources: [] });
  expect(await screen.findByText("CLI not found")).toBeTruthy();
});

// `snow SHOW WAREHOUSES` is account-wide, so in a project that does not use
// Snowflake the count belongs to some other project. The row stays (rule 1)
// and states the real reason; "0 warehouses" -- what the ternary chain renders
// without an irrelevant arm -- is the correct-but-useless answer this avoids.
it("says Snowflake is not used in this project rather than counting another project's warehouses", async () => {
  mount([], [], { status: "irrelevant", resources: [] });
  expect(await screen.findByText("not used in this project")).toBeTruthy();
  expect(screen.queryByText("0 warehouses")).toBeNull();
  expect(screen.getByText("Snowflake")).toBeTruthy(); // the row never disappears
});

it("asks integrations:resources for the PROJECT scope, not the account-wide list", async () => {
  mount();
  const api = (
    window as unknown as {
      airlock: { integrationsResources: ReturnType<typeof vi.fn> };
    }
  ).airlock;
  await waitFor(() =>
    expect(api.integrationsResources).toHaveBeenCalledWith("snowflake", true),
  );
});
