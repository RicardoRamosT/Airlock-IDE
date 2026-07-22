// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { LocalHostSection } from "./LocalHostSection";

afterEach(cleanup);

// Stub the window.airlock host/dev-server surface LocalHostSection queries on
// mount so it lands in the explicit-devUrl tier: a configured URL, a
// down/up probe, and "nothing else here" (no detected/unverified/managed).
function stubHost(opts: { url: string | null; up: boolean }) {
  const devServerStart = vi.fn(() =>
    Promise.resolve({ ok: true as const, state: {} }),
  );
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    hostLocalUrl: vi.fn(() => Promise.resolve(opts.url)),
    hostProbe: vi.fn(() => Promise.resolve({ up: opts.up })),
    devServerDetectUnmanaged: vi.fn(() => Promise.resolve(null)),
    hostUnverifiedServers: vi.fn(() => Promise.resolve([])),
    devServerStatus: vi.fn(() => Promise.resolve(null)),
    onDevServerChanged: vi.fn(() => () => {}),
    devServerStart,
    hostOpenExternal: vi.fn(),
  };
  return { devServerStart };
}

// useProjectTab() falls back to activeTabId with no provider; LocalHostSection
// reads tabState[tabId].root.
function seedRoot() {
  useApp.setState({
    activeTabId: "t1",
    tabState: { t1: { root: "/fake/root" } } as never,
  });
}

it("shows a Start button on a down dev-URL host and wires it to start", async () => {
  const { devServerStart } = stubHost({
    url: "http://localhost:3004",
    up: false,
  });
  seedRoot();
  render(<LocalHostSection />);
  // The URL row appears once the async probe resolves.
  expect(await screen.findByText("http://localhost:3004")).toBeTruthy();
  const start = await screen.findByRole("button", { name: "Start" });
  fireEvent.click(start);
  expect(devServerStart).toHaveBeenCalledWith("/fake/root");
});

it("shows a Start button on an unverified server and wires it to start", async () => {
  const devServerStart = vi.fn(() =>
    Promise.resolve({ ok: true as const, state: {} }),
  );
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    hostLocalUrl: vi.fn(() => Promise.resolve(null)),
    hostProbe: vi.fn(() => Promise.resolve({ up: false })),
    devServerDetectUnmanaged: vi.fn(() => Promise.resolve(null)),
    hostUnverifiedServers: vi.fn(() => Promise.resolve([3000])),
    devServerStatus: vi.fn(() => Promise.resolve(null)),
    onDevServerChanged: vi.fn(() => () => {}),
    devServerStart,
    hostOpenExternal: vi.fn(),
  };
  seedRoot();
  render(<LocalHostSection />);
  // The unverified row renders once the async scan resolves.
  expect(await screen.findByText(/· unverified/)).toBeTruthy();
  const start = await screen.findByRole("button", { name: "Start" });
  fireEvent.click(start);
  expect(devServerStart).toHaveBeenCalledWith("/fake/root");
});

it("shows no Start button when the dev-URL host is reachable", async () => {
  stubHost({ url: "http://localhost:3004", up: true });
  seedRoot();
  const { container } = render(<LocalHostSection />);
  // Wait until the probe result (up === true) is applied — the dot goes
  // ".status-dot on" — so we assert against the reachable state, not the
  // transient mid-probe null (which would also lack the button).
  await waitFor(() =>
    expect(container.querySelector(".status-dot.on")).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
});
