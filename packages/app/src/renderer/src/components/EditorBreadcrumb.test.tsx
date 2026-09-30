// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorBreadcrumb } from "./EditorBreadcrumb";

afterEach(cleanup);

const base = {
  pathSegments: ["src", "a.ts"],
  symbolTrail: [],
  saveState: "idle" as const,
  truncated: false,
  onSymbolClick: vi.fn(),
};

it("shows no ESLint chip for a file ESLint does not govern", () => {
  render(<EditorBreadcrumb {...base} />);
  expect(screen.queryByText(/ESLint/)).toBeNull();
});

it("shows the chip, and its menu disables ESLint for the folder", () => {
  const onDisable = vi.fn();
  const onJump = vi.fn();
  render(
    <EditorBreadcrumb
      {...base}
      eslint={{ label: "ESLint 3", tone: "problems", onJump, onDisable }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "ESLint 3" }));
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Go to first problem" }),
  );
  expect(onJump).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "ESLint 3" }));
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Disable ESLint for this folder" }),
  );
  expect(onDisable).toHaveBeenCalledTimes(1);
});

it("puts a config error's text in the tooltip, not in the file", () => {
  render(
    <EditorBreadcrumb
      {...base}
      eslint={{
        label: "ESLint ⚠",
        tone: "error",
        title: "Cannot find package 'eslint-plugin-react'",
      }}
    />,
  );
  expect(
    screen.getByRole("button", { name: "ESLint ⚠" }).getAttribute("title"),
  ).toMatch(/eslint-plugin-react/);
});
