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
  component: null,
  updatedAt: 0,
});

it("shows the Claude status label and opens the status page on click", () => {
  useApp.setState({ anthropicStatus: status("operational") });
  const { getByRole, getByText } = render(<StatusBar />);
  // Label and state are separate spans in the chip; the whole chip is the button.
  expect(getByText("Claude")).toBeTruthy();
  fireEvent.click(getByRole("button", { name: /claude/i }));
  expect(hostOpenExternal).toHaveBeenCalledWith("https://status.claude.com");
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

it("draws NO OS tooltip on the Update button, but keeps its accessible name", () => {
  // `title` draws the native tooltip, which repeated the two versions a second
  // time in a second style below a callout that had just said it better. The
  // accessible name still has to exist, so it lives on aria-label: announced,
  // never drawn.
  useApp.setState({ update: upd(true) });
  const { getByRole } = render(<StatusBar />);
  const btn = getByRole("button", { name: /Update 0\.1\.1/ });
  expect(btn.getAttribute("title")).toBeNull();
  expect(btn.getAttribute("aria-label")).toBe("Update 0.1.1 → 0.2.0");
});

it("does NOT let the label clobber live progress", () => {
  // aria-label REPLACES a button's text as its accessible name, where `title`
  // only filled in when there was none. Labelling every phase would announce
  // "Update 0.1.1 -> 0.2.0" while the button visibly reads "42%" -- a stale
  // constant in place of the one thing that is changing.
  useApp.setState({
    update: upd(true),
    updateProgress: { phase: "downloading", percent: 42 },
  });
  const { getByRole } = render(<StatusBar />);
  const btn = getByRole("button", { name: /42%/ });
  expect(btn.getAttribute("aria-label")).toBeNull();
});

it("still says WHY an update failed, now in the callout", () => {
  // That message used to live only in the button's title, so dropping the
  // tooltip would have taken the one place a sighted user could read it -- the
  // label says no more than "Update failed".
  useApp.setState({
    update: upd(true),
    updateProgress: { phase: "error", message: "disk image would not mount" },
  });
  const { getByRole, getByText } = render(<StatusBar />);
  expect(getByText("disk image would not mount")).toBeTruthy();
  expect(
    getByRole("button", { name: /Update failed: disk image would not mount/ }),
  ).toBeTruthy();
});
