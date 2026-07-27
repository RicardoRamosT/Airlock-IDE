// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

function mount(dbContainers: unknown[] = [], dbs: unknown[] = []) {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    dbList: vi.fn(async () => dbs),
    dockerDatabases: vi.fn(async () => dbContainers),
    neonStatus: vi.fn(async () => ({ connected: false })),
    integrationsResources: vi.fn(async () => []),
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
