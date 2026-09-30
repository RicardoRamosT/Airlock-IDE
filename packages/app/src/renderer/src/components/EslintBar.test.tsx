// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EslintBar } from "./EslintBar";

afterEach(cleanup);

it("asks before running a repo's ESLint, saying why it matters", () => {
  const onEnable = vi.fn();
  const onDismiss = vi.fn();
  render(
    <EslintBar
      state="untrusted"
      unit="client"
      onEnable={onEnable}
      onDismiss={onDismiss}
    />,
  );
  expect(screen.getByText(/executes code from this repo/i)).toBeTruthy();
  expect(screen.getByText("client")).toBeTruthy(); // which folder is being trusted
  fireEvent.click(screen.getByRole("button", { name: "Enable ESLint here" }));
  expect(onEnable).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("names the project root when the config is at the root", () => {
  render(
    <EslintBar
      state="untrusted"
      unit=""
      onEnable={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
  expect(screen.getByText(/this project/i)).toBeTruthy();
});

it("offers no Enable when ESLint is not installed -- there is nothing to run", () => {
  render(
    <EslintBar
      state="missing-eslint"
      unit=""
      onEnable={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
  expect(screen.getByText(/npm install/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Enable ESLint here" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
});
