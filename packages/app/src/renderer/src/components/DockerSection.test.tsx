// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Container, DbContainer } from "../../../shared/ipc";
import { useApp } from "../store";
import { DockerSection } from "./DockerSection";

afterEach(cleanup);

// A Postgres container sitting in the Docker section used to dead-end: it
// showed a name, an image and a stop button, with nothing to say that querying
// it happens in Databases. That is the same "every row links onward" rule the
// Databases/Host routers follow and the Extensions hub was just taught -- the
// section that OWNS the container was the last place still ignoring it.

const container = (patch: Partial<Container> = {}): Container =>
  ({
    id: "c1",
    name: "helm-postgres",
    image: "postgres:16-alpine",
    state: "running",
    status: "Up 48 seconds",
    ports: "127.0.0.1:5432->5432/tcp",
    ...patch,
  }) as Container;

const db = (patch: Partial<DbContainer> = {}): DbContainer =>
  ({
    id: "c1",
    name: "helm-postgres",
    image: "postgres:16-alpine",
    engine: "postgres",
    hostPort: 5432,
    ...patch,
  }) as DbContainer;

function stub(containers: Container[], databases: DbContainer[]) {
  const prefsSet = vi.fn(async () => ({}));
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    dockerList: vi.fn(async () => ({
      installed: true,
      running: true,
      containers,
    })),
    dockerDatabases: vi.fn(async () => databases),
    dockerStart: vi.fn(async () => ({ ok: true })),
    dockerStop: vi.fn(async () => ({ ok: true })),
    prefsSet,
  };
  return { prefsSet };
}

const arrow = (name = "helm-postgres") =>
  screen.queryByLabelText(`Query ${name} in Databases`);

it("links a running, published Postgres container onward to Databases", async () => {
  stub([container()], [db()]);
  render(<DockerSection />);
  await waitFor(() => expect(arrow()).not.toBeNull());
});

it("switches the sidebar to Databases when that link is clicked", async () => {
  const { prefsSet } = stub([container()], [db()]);
  render(<DockerSection />);
  await waitFor(() => expect(arrow()).not.toBeNull());
  arrow()?.click();

  expect(useApp.getState().activeView).toBe("databases");
  expect(prefsSet).toHaveBeenCalledWith({
    activeView: "databases",
    sidebarVisible: true,
  });
});

it("offers NO link for a stopped container -- Databases has no Connect for it", async () => {
  // The honest next step is the start button already beside it, not a trip to
  // a section that will show the row with no way to act on it.
  stub(
    [container({ state: "exited", status: "Exited (0) 5 days ago" })],
    [db()],
  );
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  expect(arrow()).toBeNull();
});

it("offers NO link when nothing is published to the host", async () => {
  // hostPort null means it is reachable only inside the docker network, so a
  // connection attempt could not succeed.
  stub([container({ ports: "" })], [db({ hostPort: null })]);
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  expect(arrow()).toBeNull();
});

it("offers NO link for an engine AirLock cannot query", async () => {
  // The client is pg. Redis is listed by databaseContainers so Databases can
  // admit it exists, but there is no session to open.
  stub(
    [container({ id: "c2", name: "cache", image: "redis:7" })],
    [db({ id: "c2", name: "cache", image: "redis:7", engine: "redis" })],
  );
  render(<DockerSection />);
  await screen.findByText("cache");
  expect(arrow("cache")).toBeNull();
});

it("offers NO link for a plain container that is not a database at all", async () => {
  stub([container({ id: "c3", name: "web", image: "nginx:latest" })], []);
  render(<DockerSection />);
  await screen.findByText("web");
  expect(arrow("web")).toBeNull();
});

it("still lists containers when the database lookup fails", async () => {
  // The -> is an affordance, not the payload: losing it must not cost the
  // container list or the start/stop buttons.
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    dockerList: vi.fn(async () => ({
      installed: true,
      running: true,
      containers: [container()],
    })),
    dockerDatabases: vi.fn(async () => {
      throw new Error("docker gone");
    }),
    prefsSet: vi.fn(async () => ({})),
  };
  render(<DockerSection />);
  expect(await screen.findByText("helm-postgres")).toBeTruthy();
  expect(arrow()).toBeNull();
});
