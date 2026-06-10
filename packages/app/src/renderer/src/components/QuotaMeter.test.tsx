// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { QuotaStatus } from "../../../shared/ipc";
import { useApp } from "../store";
import { QuotaMeter } from "./QuotaMeter";

afterEach(cleanup);

// Epoch seconds "now"; an emit stamped here counts as fresh (active session).
const nowSec = () => Math.floor(Date.now() / 1000);

const liveQuota = (over: Partial<QuotaStatus> = {}): QuotaStatus => ({
  fiveHour: { usedPercentage: 39, resetsAt: 9_999_999_999 },
  sevenDay: { usedPercentage: 22, resetsAt: 9_999_999_999 },
  model: "Opus 4.8",
  updatedAt: nowSec(),
  available: true,
  ...over,
});

it("renders nothing when the meter is disabled", () => {
  useApp.setState({ quotaMeterEnabled: false, quota: null });
  const { container } = render(<QuotaMeter />);
  expect(container.firstChild).toBeNull();
});

it("prompts to start a session when there is no data", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: null });
  render(<QuotaMeter />);
  expect(
    screen.getByText("Start a Claude session to see your usage limits"),
  ).toBeTruthy();
});

it("prompts to start a session when the last emit is stale (no active session)", () => {
  useApp.setState({
    quotaMeterEnabled: true,
    quota: liveQuota({ updatedAt: nowSec() - 600 }), // 10 min old
  });
  render(<QuotaMeter />);
  expect(
    screen.getByText("Start a Claude session to see your usage limits"),
  ).toBeTruthy();
});

it("shows 'waiting for usage data' when a session is active but limits are absent", () => {
  useApp.setState({
    quotaMeterEnabled: true,
    quota: liveQuota({ fiveHour: null, sevenDay: null, available: false }),
  });
  render(<QuotaMeter />);
  expect(screen.getByText("Waiting for usage data…")).toBeTruthy();
});

it("shows the reset countdown when only the 7d window is present", () => {
  // {fiveHour: null, sevenDay: set} is a valid parsed state (each window is
  // validated independently); the reset line must not vanish with the 5h one.
  useApp.setState({
    quotaMeterEnabled: true,
    quota: liveQuota({ fiveHour: null }),
  });
  const { container } = render(<QuotaMeter />);
  expect(screen.getByText("7d")).toBeTruthy();
  const reset = container.querySelector(".quota-reset");
  expect(reset).toBeTruthy();
  // The 7d bar row keeps its "7d" label; the reset line names it "weekly".
  expect(reset?.textContent).toContain("weekly");
});

it("renders 5h and 7d rows with percentages when fresh and available", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: liveQuota() });
  render(<QuotaMeter />);
  expect(screen.getByText("5h")).toBeTruthy();
  expect(screen.getByText("7d")).toBeTruthy();
  expect(screen.getByText("39%")).toBeTruthy();
  expect(screen.getByText("22%")).toBeTruthy();
});

it("shows both session and weekly reset countdowns on one line when both are present", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: liveQuota() });
  const { container } = render(<QuotaMeter />);
  const reset = container.querySelector(".quota-reset");
  expect(reset).toBeTruthy();
  // Both windows' labeled countdowns share the single reset line, joined by "·".
  // The labels are words ("session"/"weekly") so they don't blend with the h/d
  // countdown the way "5h"/"7d" would.
  expect(reset?.textContent).toContain("session");
  expect(reset?.textContent).toContain("weekly");
  expect(reset?.textContent).toContain("·");
});
