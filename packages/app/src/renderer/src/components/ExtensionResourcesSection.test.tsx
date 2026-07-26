// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExtensionResourcesSection } from "./ExtensionResourcesSection";

const resourcesFor = vi.fn();

beforeEach(() => {
  resourcesFor.mockReset();
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsResourcesFor: resourcesFor,
  };
});

afterEach(() => cleanup());

it("renders the extension's resources as rows", async () => {
  resourcesFor.mockResolvedValue([
    { id: "r1", title: "prod-db", subtitle: "us-east", state: "ok" },
  ]);
  render(<ExtensionResourcesSection extId="azure" />);
  expect(await screen.findByText("prod-db")).toBeTruthy();
  expect(resourcesFor).toHaveBeenCalledWith("azure");
});

it("shows an empty note rather than a blank panel", async () => {
  resourcesFor.mockResolvedValue([]);
  render(<ExtensionResourcesSection extId="azure" />);
  expect(await screen.findByText(/Nothing to show/i)).toBeTruthy();
});

it("degrades to the empty note when the fetch rejects", async () => {
  resourcesFor.mockRejectedValue(new Error("boom"));
  render(<ExtensionResourcesSection extId="azure" />);
  await act(async () => {});
  expect(screen.getByText(/Nothing to show/i)).toBeTruthy();
});
