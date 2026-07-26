// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExtensionSummary } from "../../../shared/ipc";
import { ExtensionsTab } from "./ExtensionsTab";

const list = vi.fn();

beforeEach(() => {
  list.mockReset();
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsList: list,
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
  list.mockResolvedValue(SUMMARIES);
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
  list.mockResolvedValue(SUMMARIES);
  render(<ExtensionsTab />);
  // The detail header names the bound account.
  expect(await screen.findByText(/Airlock/)).toBeTruthy();
});

it("switches the detail pane when another extension is picked", async () => {
  list.mockResolvedValue(SUMMARIES);
  render(<ExtensionsTab />);
  const listEl2 = document.querySelector(".ext-page-list") as HTMLElement;
  fireEvent.click(await within(listEl2).findByText("Vercel"));
  expect(screen.getByText(/is not installed/i)).toBeTruthy();
});

it("prompts to choose when there are no extensions at all", async () => {
  list.mockResolvedValue([]);
  render(<ExtensionsTab />);
  expect(await screen.findByText(/Choose an extension/i)).toBeTruthy();
});
