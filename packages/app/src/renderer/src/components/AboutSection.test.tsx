// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AboutSection } from "./AboutSection";

afterEach(cleanup);

const api = {
  appInfo: vi.fn(async () => ({ version: "0.7.0", mcpPort: 51234 })),
  updateGet: vi.fn(async () => ({
    available: false,
    currentVersion: "0.7.0",
  })),
  onUpdateChanged: () => () => {},
  onUpdateProgress: () => () => {},
  openLicenseDoc: vi.fn(async (_k: string) => true),
};

beforeEach(() => {
  api.appInfo.mockClear();
  api.openLicenseDoc.mockClear();
  (window as unknown as { airlock: unknown }).airlock = api;
});

it("states the licence AirLock is under, and that work needs a different one", async () => {
  // The whole point of shipping the licence: someone using AirLock at a company
  // has to be able to find out that the default grant does not cover them.
  render(<AboutSection />);
  await waitFor(() => expect(screen.getByText(/PolyForm Strict/)).toBeTruthy());
  expect(screen.getByText(/needs a separate licence/i)).toBeTruthy();
});

it("opens each licence document by KIND, never by path", async () => {
  // The renderer must not be able to name a file. If this ever starts passing a
  // path, the main-side allow-list is the only thing left standing.
  render(<AboutSection />);
  await waitFor(() => expect(screen.getByText(/PolyForm Strict/)).toBeTruthy());

  for (const [name, kind] of [
    [/read the licence/i, "license"],
    [/commercial use/i, "commercial"],
    [/^Electron$/, "electron"],
    [/^Chromium$/, "chromium"],
  ] as const) {
    screen.getByRole("button", { name }).click();
    await waitFor(() => expect(api.openLicenseDoc).toHaveBeenCalledWith(kind));
  }
  expect(api.openLicenseDoc).toHaveBeenCalledTimes(4);
});

it("credits the icon set, which is the one dependency wanting visible credit", async () => {
  // codicons is CC BY 4.0: shipping its licence file is not the same as giving
  // credit, and it is the only bundled package that asks for the latter.
  render(<AboutSection />);
  await waitFor(() => expect(screen.getByText(/codicons/)).toBeTruthy());
  expect(screen.getByText(/CC BY 4\.0/)).toBeTruthy();
});
