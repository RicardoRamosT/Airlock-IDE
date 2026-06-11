// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AnthropicStatus, UpdateStatus } from "../../../shared/ipc";
import { useApp } from "../store";
import { StatusBar } from "./StatusBar";

const initialState = useApp.getState();

let hostOpenExternal: ReturnType<typeof vi.fn>;
let updateApply: ReturnType<typeof vi.fn>;

beforeEach(() => {
  hostOpenExternal = vi.fn(() => Promise.resolve(undefined));
  updateApply = vi.fn(() => Promise.resolve(undefined));
  window.airlock = new Proxy(
    { hostOpenExternal, updateApply },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});

afterEach(cleanup);

const status = (indicator: AnthropicStatus["indicator"]): AnthropicStatus => ({
  indicator,
  description: "x",
  updatedAt: 0,
});

it("shows the Claude status label and opens the status page on click", () => {
  useApp.setState({ anthropicStatus: status("operational") });
  const { getByText } = render(<StatusBar />);
  fireEvent.click(getByText(/Claude:/));
  expect(hostOpenExternal).toHaveBeenCalledWith("https://status.anthropic.com");
});

it("renders the indicator word for each state", () => {
  for (const ind of ["operational", "degraded", "outage", "unknown"] as const) {
    cleanup();
    useApp.setState({ anthropicStatus: status(ind) });
    const { getByText } = render(<StatusBar />);
    expect(getByText(new RegExp(ind))).toBeTruthy();
  }
});

const upd = (available: boolean): UpdateStatus => ({
  available,
  currentVersion: "0.1.1",
  latestVersion: available ? "0.2.0" : null,
  htmlUrl: available ? "https://h" : null,
  dmgUrl: available ? "https://d.dmg" : null,
});

it("shows no Update button when none is available", () => {
  useApp.setState({ update: upd(false) });
  const { queryByText } = render(<StatusBar />);
  expect(queryByText("Update")).toBeNull();
});

it("shows the Update button when available and applies on click", () => {
  useApp.setState({ update: upd(true) });
  const { getByText } = render(<StatusBar />);
  fireEvent.click(getByText("Update"));
  expect(updateApply).toHaveBeenCalled();
});

it("renders the download percent while applying and disables the button", () => {
  useApp.setState({
    update: upd(true),
    updateProgress: { phase: "downloading", percent: 42 },
  });
  const { getByRole } = render(<StatusBar />);
  const btn = getByRole("button", { name: /42%/ });
  expect((btn as HTMLButtonElement).disabled).toBe(true);
});
