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

it("marks the window length with ticks -- 5 for hours, 7 for days", () => {
  // This is the indicator telling the two wings apart, instead of a text caption.
  useApp.setState({ quotaMeterEnabled: true, quota: status() });
  const { container } = render(<TitleQuota>{child}</TitleQuota>);
  const segs = (sel: string) =>
    container.querySelector<HTMLElement>(sel)?.style.getPropertyValue("--segs");
  expect(segs(".titlebar-wing.left")).toBe("5");
  expect(segs(".titlebar-wing.right")).toBe("7");
  expect(container.querySelectorAll(".titlebar-wing-ticks")).toHaveLength(2);
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
