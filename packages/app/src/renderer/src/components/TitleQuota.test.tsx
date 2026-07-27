// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QuotaStatus } from "../../../shared/ipc";
import { useApp } from "../store";
import { TitleQuota } from "./TitleQuota";

const initial = useApp.getState();
beforeEach(() => {
  useApp.setState(initial, true);
  window.airlock = new Proxy(
    {},
    { get: () => () => Promise.resolve(undefined) },
  ) as unknown as typeof window.airlock;
});
afterEach(cleanup);

const now = () => Math.floor(Date.now() / 1000);

const status = (over: Partial<QuotaStatus> = {}): QuotaStatus =>
  ({
    available: true,
    updatedAt: now(),
    model: "Sonnet",
    fiveHour: { usedPercentage: 38, resetsAt: now() + 3600 },
    sevenDay: { usedPercentage: 42, resetsAt: now() + 86400 },
    ...over,
  }) as QuotaStatus;

const child = <span className="titlebar-title">AirLock</span>;

it("renders a wing per window with its rounded percentage", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: status() });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  expect(container.querySelectorAll(".titlebar-wing")).toHaveLength(2);
  expect(screen.getByText("38%")).toBeTruthy();
  expect(screen.getByText("42%")).toBeTruthy();
});

// The countdowns used to be tooltip-only, so the titlebar showed two bare
// percentages and you had to hover to learn when either window resets.
it("shows the reset countdown on BOTH wings, not just in the tooltip", () => {
  useApp.setState({
    quotaMeterEnabled: true,
    quota: status({
      fiveHour: { usedPercentage: 38, resetsAt: now() + 3 * 3600 + 780 },
      sevenDay: { usedPercentage: 42, resetsAt: now() + 2 * 86400 + 4 * 3600 },
    } as Partial<QuotaStatus>),
  });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  const shown = [...container.querySelectorAll(".titlebar-wing-reset")].map(
    (n) => n.textContent,
  );
  expect(shown).toEqual(["3h 13m", "2d 4h"]);
});

it("reads idle on a window that has not started yet", () => {
  useApp.setState({
    quotaMeterEnabled: true,
    quota: status({
      fiveHour: {
        usedPercentage: 0,
        resetsAt: now() + 3600,
        awaitingNextWindow: true,
      },
    } as Partial<QuotaStatus>),
  });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  expect(
    container.querySelector(".titlebar-wing.left .titlebar-wing-reset")
      ?.textContent,
  ).toBe("idle");
});

it("always keeps the title centered between the wings", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: status() });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  const group = container.querySelector(".titlebar-center");
  const kids = [...(group?.children ?? [])].map((c) => c.className);
  // left wing, title card, right wing -- in that order.
  expect(kids[0]).toContain("left");
  expect(kids[1]).toContain("titlebar-title");
  expect(kids[2]).toContain("right");
});

it("opens the Usage page when a wing is clicked", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: status() });
  const spy = vi.spyOn(useApp.getState(), "openAppPage");
  render(<TitleQuota>{child}</TitleQuota>);
  fireEvent.click(screen.getByLabelText(/5-hour usage/));
  expect(spy).toHaveBeenCalledWith("usage");
  fireEvent.click(screen.getByLabelText(/7-day usage/));
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});

it("colours each fill from its own percentage (red past 90, calmer below)", () => {
  useApp.setState({
    quotaMeterEnabled: true,
    quota: status({
      fiveHour: { usedPercentage: 94, resetsAt: now() + 600 },
      sevenDay: { usedPercentage: 20, resetsAt: now() + 86400 },
    } as Partial<QuotaStatus>),
  });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  const hue = (sel: string) => {
    const el = container.querySelector<HTMLElement>(sel);
    return Number(
      /hsl\((\d+)/.exec(el?.style.getPropertyValue("--wing-tone") ?? "")?.[1],
    );
  };
  // 94% is pinned red; 20% is still in the blue part of the ramp.
  expect(hue(".titlebar-wing.left .titlebar-wing-fill")).toBe(2);
  expect(hue(".titlebar-wing.right .titlebar-wing-fill")).toBeGreaterThan(180);
});

it("marks which window each wing is with an icon, not a text caption", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: status() });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  // Clock = rolling 5-hour session, calendar = 7-day week.
  expect(
    container.querySelector(".titlebar-wing.left .codicon-clock"),
  ).toBeTruthy();
  expect(
    container.querySelector(".titlebar-wing.right .codicon-calendar"),
  ).toBeTruthy();
  // No "5h"/"7d" captions, and no tick overlay (it read as clutter).
  expect(container.textContent).not.toContain("5h");
  expect(container.textContent).not.toContain("7d");
  expect(container.querySelector(".titlebar-wing-ticks")).toBeNull();
});

it("puts each marker OUTSIDE its gauge box, on the far side of the group", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: status() });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  // Never inside the track -- the fill and percentage own that space. Same for
  // the countdown, which sits next to the marker on the titlebar itself.
  expect(container.querySelector(".titlebar-wing-track .codicon")).toBeNull();
  expect(
    container.querySelector(".titlebar-wing-track .titlebar-wing-reset"),
  ).toBeNull();
  const kids = (sel: string) =>
    [...(container.querySelector(sel)?.children ?? [])].map((c) => c.className);
  // Countdown outermost, then the marker, then the gauge -- so each marker is
  // the item nearest the title, mirrored on the right.
  expect(kids(".titlebar-wing.left")[0]).toContain("titlebar-wing-reset");
  expect(kids(".titlebar-wing.left")[1]).toContain("codicon-clock");
  expect(kids(".titlebar-wing.left")[2]).toContain("titlebar-wing-track");
  expect(kids(".titlebar-wing.right")[0]).toContain("titlebar-wing-track");
  expect(kids(".titlebar-wing.right")[1]).toContain("codicon-calendar");
  expect(kids(".titlebar-wing.right")[2]).toContain("titlebar-wing-reset");
});

it("keeps both wings (empty) when no session is feeding it, so nothing shifts", () => {
  // Stale emit => no live session. The tracks must still occupy their space.
  useApp.setState({
    quotaMeterEnabled: true,
    quota: status({ updatedAt: now() - 600 }),
  });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  expect(container.querySelectorAll(".titlebar-wing")).toHaveLength(2);
  expect(container.querySelectorAll(".titlebar-wing-fill")).toHaveLength(0);
  expect(screen.getAllByText("—")).toHaveLength(2);
});

it("renders the bare title card when the meter is disabled", () => {
  useApp.setState({ quotaMeterEnabled: false, quota: status() });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  expect(container.querySelectorAll(".titlebar-wing")).toHaveLength(0);
  // Still wrapped in the centering group, so the title does not move.
  expect(container.querySelector(".titlebar-center")).toBeTruthy();
  expect(container.querySelector(".titlebar-title")).toBeTruthy();
});
