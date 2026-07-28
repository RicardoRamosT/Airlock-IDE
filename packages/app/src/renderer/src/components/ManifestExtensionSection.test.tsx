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
} from "./ManifestExtensionSection";

afterEach(cleanup);

function mockResources(
  fn: (id: string, scoped?: boolean) => Promise<SteadyIntegration | null>,
) {
  (
    window as unknown as {
      airlock: {
        integrationsResources: (
          id: string,
          scoped?: boolean,
        ) => Promise<SteadyIntegration | null>;
      };
    }
  ).airlock = { integrationsResources: vi.fn(fn) };
}

// CRITICAL #1 (2026-07-27 fix wave): before this component existed,
// ext:snowflake/azure had no EXTENSION_VIEWS entry, so Sidebar.tsx fell
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
    id: "snowflake",
    name: "Snowflake",
    view: "databases",
    status: "ready",
    resources: [
      {
        id: "int:snowflake:1",
        title: "COMPUTE_WH",
        subtitle: "",
        state: "running",
      },
    ],
  }));
  render(<ManifestExtensionSection id="snowflake" />);
  expect(await screen.findByText("COMPUTE_WH")).toBeTruthy();
});

it("says there are no resources rather than rendering a blank panel", async () => {
  mockResources(async () => ({
    id: "snowflake",
    name: "Snowflake",
    view: "databases",
    status: "ready",
    resources: [],
  }));
  render(<ManifestExtensionSection id="snowflake" />);
  expect(await screen.findByText("No resources.")).toBeTruthy();
  expect(screen.queryByText("Nothing to show yet.")).toBeNull();
});

// `true` is the project-scoped opt-in on integrations:resources. This section
// belongs to ONE project, so it must never be handed the account-wide list --
// the leak this asserts against showed ElArqui every LendLogic web app in the
// subscription. The Extension Hub calls the same IPC WITHOUT it, on purpose.
it("fetches by the manifest id it was given, not a fixed one, and asks for the PROJECT scope", async () => {
  const fn = vi.fn(async () => null);
  mockResources(fn);
  render(<ManifestExtensionSection id="azure" />);
  await waitFor(() => expect(fn).toHaveBeenCalledWith("azure", true));
});

it("registers a distinct wrapper per extension, each fetching its own id", async () => {
  const fn = vi.fn(async () => null);
  mockResources(fn);

  render(<SnowflakeSection />);
  await waitFor(() => expect(fn).toHaveBeenCalledWith("snowflake", true));
  cleanup();
  fn.mockClear();

  render(<AzureSection />);
  await waitFor(() => expect(fn).toHaveBeenCalledWith("azure", true));
});

// An account-wide CLI in a project that does not use it. The old behaviour was
// to list the whole subscription -- in practice ANOTHER project's resources.
// The reason must be specific enough to act on, so it is derived from the
// manifest's own `relevance` spec rather than hardcoded per extension.
it("says the extension isn't used in this project, and names what would change that", async () => {
  mockResources(async () => ({
    id: "azure",
    name: "Azure",
    view: "host",
    status: "irrelevant",
    resources: [],
    relevance: {
      envPrefix: "AZURE_",
      files: ["azure.yaml", "azure.yml", ".azure"],
    },
  }));
  render(<ManifestExtensionSection id="azure" />);
  expect(
    await screen.findByText("Azure isn't used in this project."),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Add azure.yaml to the project root, or vault a secret starting with AZURE_.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText("Nothing to show yet.")).toBeNull();
});

it("names the prefix alone for a manifest that declares no files, so Snowflake reads correctly", async () => {
  mockResources(async () => ({
    id: "snowflake",
    name: "Snowflake",
    view: "databases",
    status: "irrelevant",
    resources: [],
    relevance: { envPrefix: "SNOWFLAKE_" },
  }));
  render(<ManifestExtensionSection id="snowflake" />);
  expect(
    await screen.findByText("Snowflake isn't used in this project."),
  ).toBeTruthy();
  expect(
    screen.getByText("Vault a secret starting with SNOWFLAKE_."),
  ).toBeTruthy();
  // No file signal exists for Snowflake, so inventing one would be a lie.
  expect(screen.queryByText(/project root/)).toBeNull();
});

it("renders no resource rows when irrelevant, even if the payload carried some", async () => {
  mockResources(async () => ({
    id: "azure",
    name: "Azure",
    view: "host",
    status: "irrelevant",
    // The handler returns [] here; this asserts the RENDERER does not fall
    // through to the ready branch, so a future regression on either side
    // cannot leak another project's rows.
    resources: [
      {
        id: "int:azure:leak",
        title: "lendlogic-los-app-bnk-qa-eus2",
        subtitle: "rg-lendlogic",
        state: "running",
      },
    ],
    relevance: { envPrefix: "AZURE_" },
  }));
  render(<ManifestExtensionSection id="azure" />);
  await screen.findByText("Azure isn't used in this project.");
  expect(screen.queryByText("lendlogic-los-app-bnk-qa-eus2")).toBeNull();
});
