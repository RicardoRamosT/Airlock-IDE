// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExtensionSummary } from "../../../shared/ipc";
import { useApp } from "../store";
import { ExtensionsSection } from "./ExtensionsSection";

const prefsSet = vi.fn(() => Promise.resolve({} as never));

afterEach(() => {
  cleanup();
  prefsSet.mockClear();
  useApp.setState({ extensionsPrefs: {} });
});

const mockApi = (list: ExtensionSummary[]) => {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsList: vi.fn(() => Promise.resolve(list)),
    prefsSet,
  };
};

const summary = (over: Partial<ExtensionSummary>): ExtensionSummary => ({
  id: "x",
  name: "X",
  tier: "status",
  status: "ready",
  enabled: true,
  pinned: false,
  hasConfig: false,
  authKind: "token",
  ...over,
});

it("groups integrations by status and shows a Disabled group", async () => {
  mockApi([
    summary({ id: "azure", name: "Azure", category: "host", status: "ready" }),
    summary({ id: "vercel", name: "Vercel", status: "absent" }),
    summary({
      id: "snow",
      name: "Snowflake",
      status: "disabled",
      enabled: false,
    }),
  ]);
  render(<ExtensionsSection />);
  expect(await screen.findByText("Azure")).toBeTruthy();
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(screen.getByText("Not installed")).toBeTruthy();
  expect(screen.getByText("Disabled")).toBeTruthy();
});

it("pins a category integration -> prefsSet with the merged extensions map", async () => {
  mockApi([
    summary({ id: "azure", name: "Azure", category: "host", status: "ready" }),
  ]);
  render(<ExtensionsSection />);
  const pin = await screen.findByRole("button", { name: /pin azure/i });
  fireEvent.click(pin);
  await waitFor(() =>
    expect(prefsSet).toHaveBeenCalledWith({
      extensions: { azure: { pinned: true } },
    }),
  );
});

it("offers no pin control for a category-less integration", async () => {
  mockApi([summary({ id: "nc", name: "NoCat", status: "ready" })]); // no category
  render(<ExtensionsSection />);
  await screen.findByText("NoCat");
  expect(screen.queryByRole("button", { name: /pin nocat/i })).toBeNull();
});

it("shows an empty-state note when there are no integrations", async () => {
  mockApi([]);
  const { container } = render(<ExtensionsSection />);
  await waitFor(() => expect(window.airlock.extensionsList).toHaveBeenCalled());
  expect(container.querySelector(".section-empty")).toBeTruthy();
});
