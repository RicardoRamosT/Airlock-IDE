// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useApp } from "../store";
import { QuotaMeter } from "./QuotaMeter";

afterEach(cleanup);

it("renders nothing when the meter is disabled", () => {
  useApp.setState({ quotaMeterEnabled: false, quota: null });
  const { container } = render(<QuotaMeter />);
  expect(container.firstChild).toBeNull();
});

it("shows the waiting state when enabled with no data yet", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: null });
  render(<QuotaMeter />);
  expect(screen.getByText("Waiting for Claude…")).toBeTruthy();
});

it("shows unavailable when an emit arrived without rate limits", () => {
  useApp.setState({
    quotaMeterEnabled: true,
    quota: {
      fiveHour: null,
      sevenDay: null,
      model: null,
      updatedAt: 1,
      available: false,
    },
  });
  render(<QuotaMeter />);
  expect(screen.getByText("Rate limits unavailable")).toBeTruthy();
});

it("renders 5h and 7d rows with percentages when available", () => {
  useApp.setState({
    quotaMeterEnabled: true,
    quota: {
      fiveHour: { usedPercentage: 39, resetsAt: 9_999_999_999 },
      sevenDay: { usedPercentage: 22, resetsAt: 9_999_999_999 },
      model: "Opus 4.8",
      updatedAt: 1,
      available: true,
    },
  });
  render(<QuotaMeter />);
  expect(screen.getByText("5h")).toBeTruthy();
  expect(screen.getByText("7d")).toBeTruthy();
  expect(screen.getByText("39%")).toBeTruthy();
  expect(screen.getByText("22%")).toBeTruthy();
});
