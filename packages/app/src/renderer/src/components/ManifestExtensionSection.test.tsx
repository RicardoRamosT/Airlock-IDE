// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SteadyIntegration } from "../../../shared/ipc";
import { useApp } from "../store";
import {
  AzureSection,
  ManifestExtensionSection,
  SnowflakeSection,
  VercelSection,
} from "./ManifestExtensionSection";

afterEach(cleanup);

function mockResources(fn: (id: string) => Promise<SteadyIntegration | null>) {
  (
    window as unknown as {
      airlock: {
        integrationsResources: (
          id: string,
        ) => Promise<SteadyIntegration | null>;
      };
    }
  ).airlock = { integrationsResources: vi.fn(fn) };
}

// CRITICAL #1 (2026-07-27 fix wave): before this component existed,
// ext:snowflake/azure/vercel had no EXTENSION_VIEWS entry, so Sidebar.tsx fell
// through to ExtensionResourcesSection -- which calls extensions:resourcesFor,
// an IPC that only knows Tier-2 CONNECTED_PROVIDERS ids (slack/github) and
// returns [] for anything else. Every one of these three states therefore
// rendered the SAME "Nothing to show yet.", with no distinction between "CLI
// not found", "not signed in", and "signed in with nothing to show" -- a
// permanent dead end masquerading as an empty state. Every assertion below
// names a DIFFERENT, TRUE reason and would FAIL against that old fallback,
// which never produces any of this text.

it("says the CLI is not installed, with an Install button that runs the install command", async () => {
  mockResources(async () => ({
    id: "snowflake",
    name: "Snowflake",
    view: "databases",
    status: "absent",
    resources: [],
    install: { command: "brew install snowflake-cli" },
  }));
  const runInNewTerminal = vi.fn();
  useApp.setState({ runInNewTerminal });
  render(<ManifestExtensionSection id="snowflake" />);
  expect(await screen.findByText("Snowflake is not installed.")).toBeTruthy();
  expect(screen.queryByText("Nothing to show yet.")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Install Snowflake CLI" }),
  );
  expect(runInNewTerminal).toHaveBeenCalledWith("brew install snowflake-cli");
});

it("says it's installed but not signed in, with a Connect button that runs the connect command", async () => {
  mockResources(async () => ({
    id: "azure",
    name: "Azure",
    view: "host",
    status: "unauthed",
    resources: [],
    connect: { command: "az login" },
  }));
  const runInNewTerminal = vi.fn();
  useApp.setState({ runInNewTerminal });
  render(<ManifestExtensionSection id="azure" />);
  expect(await screen.findByText("Installed, not signed in.")).toBeTruthy();
  expect(screen.queryByText("Nothing to show yet.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Connect Azure" }));
  expect(runInNewTerminal).toHaveBeenCalledWith("az login");
});

it("renders a row per resource when ready", async () => {
  mockResources(async () => ({
    id: "vercel",
    name: "Vercel",
    view: "activity",
    status: "ready",
    resources: [
      { id: "int:vercel:1", title: "web", subtitle: "main", state: "running" },
    ],
  }));
  render(<ManifestExtensionSection id="vercel" />);
  expect(await screen.findByText("web")).toBeTruthy();
});

it("says there are no resources rather than rendering a blank panel", async () => {
  mockResources(async () => ({
    id: "vercel",
    name: "Vercel",
    view: "activity",
    status: "ready",
    resources: [],
  }));
  render(<ManifestExtensionSection id="vercel" />);
  expect(await screen.findByText("No resources.")).toBeTruthy();
  expect(screen.queryByText("Nothing to show yet.")).toBeNull();
});

it("fetches by the manifest id it was given, not a fixed one", async () => {
  const fn = vi.fn(async () => null);
  mockResources(fn);
  render(<ManifestExtensionSection id="azure" />);
  await waitFor(() => expect(fn).toHaveBeenCalledWith("azure"));
});

it("registers a distinct wrapper per extension, each fetching its own id", async () => {
  const fn = vi.fn(async () => null);
  mockResources(fn);

  render(<SnowflakeSection />);
  await waitFor(() => expect(fn).toHaveBeenCalledWith("snowflake"));
  cleanup();
  fn.mockClear();

  render(<AzureSection />);
  await waitFor(() => expect(fn).toHaveBeenCalledWith("azure"));
  cleanup();
  fn.mockClear();

  render(<VercelSection />);
  await waitFor(() => expect(fn).toHaveBeenCalledWith("vercel"));
});
