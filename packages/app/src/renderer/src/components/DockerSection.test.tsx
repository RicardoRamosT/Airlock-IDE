// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Container, DbContainer, DbTable } from "../../../shared/ipc";
import { useApp } from "../store";
import { DockerSection } from "./DockerSection";

afterEach(cleanup);

// The Docker section used to show a name, an image and a stop button, and
// nothing else -- so the container holding your database was the ONE place
// that told you least about it. It is now a lazy tree to the same depth Neon's
// section reaches: container -> databases -> tables, with a click opening the
// rows in a DataGrid.

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

const dbc = (patch: Partial<DbContainer> = {}): DbContainer =>
  ({
    id: "c1",
    name: "helm-postgres",
    image: "postgres:16-alpine",
    engine: "postgres",
    hostPort: 5432,
    ...patch,
  }) as DbContainer;

const TABLES: DbTable[] = [
  { schema: "public", name: "users" },
  { schema: "billing", name: "invoices" },
];

function stub(
  opts: {
    containers?: Container[];
    databases?: DbContainer[];
    ready?: boolean;
    pgDatabases?: string[];
    tables?: DbTable[];
    pgDatabasesThrows?: boolean;
  } = {},
) {
  const dockerPgTables = vi.fn(async () => opts.tables ?? TABLES);
  const dockerPgDatabases = vi.fn(async () => {
    if (opts.pgDatabasesThrows)
      throw new Error("password authentication failed");
    return opts.pgDatabases ?? ["postgres", "helm"];
  });
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    dockerList: vi.fn(async () => ({
      installed: true,
      running: true,
      containers: opts.containers ?? [container()],
    })),
    dockerDatabases: vi.fn(async () => opts.databases ?? [dbc()]),
    dockerPgReady: vi.fn(async () => opts.ready ?? true),
    dockerPgDatabases,
    dockerPgTables,
    dockerStart: vi.fn(async () => ({ ok: true })),
    dockerStop: vi.fn(async () => ({ ok: true })),
    prefsSet: vi.fn(async () => ({})),
  };
  return { dockerPgTables, dockerPgDatabases };
}

const expander = (name = "helm-postgres") =>
  screen.queryByLabelText(new RegExp(`(Expand|Collapse) ${name} databases`));

it("offers an expander for a running, published Postgres container", async () => {
  stub();
  render(<DockerSection />);
  expect(await screen.findByText("helm-postgres")).toBeTruthy();
  expect(expander()).not.toBeNull();
});

it("fetches NOTHING until the container is expanded", async () => {
  // The tree is lazy for the same reason Neon's is: expanding is a real
  // connection to a real database server, so merely opening the section must
  // not make one.
  const { dockerPgDatabases } = stub();
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  expect(dockerPgDatabases).not.toHaveBeenCalled();
});

it("lists the databases when expanded", async () => {
  stub();
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  fireEvent.click(expander() as HTMLElement);
  expect(await screen.findByText("helm")).toBeTruthy();
  expect(screen.getByText("postgres")).toBeTruthy();
});

it("lists a database's tables when IT is expanded, and not before", async () => {
  const { dockerPgTables } = stub();
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  fireEvent.click(expander() as HTMLElement);
  await screen.findByText("helm");
  expect(dockerPgTables).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText("helm"));
  expect(await screen.findByText("users")).toBeTruthy();
  expect(dockerPgTables).toHaveBeenCalledWith("c1", "helm");
});

it("qualifies a table outside the public schema, and bares one inside it", async () => {
  stub();
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  fireEvent.click(expander() as HTMLElement);
  fireEvent.click(await screen.findByText("helm"));
  // public.users reads as "users"; billing.invoices keeps its schema, since
  // the name alone would be ambiguous.
  expect(await screen.findByText("users")).toBeTruthy();
  expect(screen.getByText("billing.invoices")).toBeTruthy();
});

it("opens a db tab addressed by CONTAINER ID, never a connection URL", async () => {
  // The URL is built in main from the container's env and must never reach the
  // renderer, so the container id is the only handle the view can carry.
  stub();
  useApp.setState({ dbTabs: [], dbView: null });
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  fireEvent.click(expander() as HTMLElement);
  fireEvent.click(await screen.findByText("helm"));
  fireEvent.click(await screen.findByText("users"));

  expect(useApp.getState().dbView).toEqual({
    kind: "docker",
    containerId: "c1",
    database: "helm",
    schema: "public",
    table: "users",
  });
});

it("says credentials are missing rather than showing an empty database list", async () => {
  // ready:false is NOT the same as "connected, no databases" -- without this
  // distinction a server we cannot reach looks like an empty one.
  stub({ ready: false, pgDatabases: [] });
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  fireEvent.click(expander() as HTMLElement);
  expect(await screen.findByText(/No credentials found/)).toBeTruthy();
});

it("says 'No databases' when the server is reachable but empty", async () => {
  stub({ ready: true, pgDatabases: [] });
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  fireEvent.click(expander() as HTMLElement);
  expect(await screen.findByText("No databases.")).toBeTruthy();
  expect(screen.queryByText(/No credentials found/)).toBeNull();
});

it("surfaces a connection error instead of rendering an empty tree", async () => {
  stub({ pgDatabasesThrows: true });
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  fireEvent.click(expander() as HTMLElement);
  expect(
    await screen.findByText(/password authentication failed/),
  ).toBeTruthy();
});

it("offers NO expander for a stopped container", async () => {
  stub({ containers: [container({ state: "exited" })] });
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  expect(expander()).toBeNull();
});

it("offers NO expander when nothing is published to the host", async () => {
  stub({
    containers: [container({ ports: "" })],
    databases: [dbc({ hostPort: null })],
  });
  render(<DockerSection />);
  await screen.findByText("helm-postgres");
  expect(expander()).toBeNull();
});

it("offers NO expander for an engine AirLock cannot query", async () => {
  stub({
    containers: [container({ id: "c2", name: "cache", image: "redis:7" })],
    databases: [dbc({ id: "c2", name: "cache", engine: "redis" })],
  });
  render(<DockerSection />);
  await screen.findByText("cache");
  expect(expander("cache")).toBeNull();
});

it("still lists containers when the database lookup fails", async () => {
  // The tree is an enhancement; losing it must not cost the container list or
  // the start/stop buttons that were the section's original job.
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
  expect(expander()).toBeNull();
});
