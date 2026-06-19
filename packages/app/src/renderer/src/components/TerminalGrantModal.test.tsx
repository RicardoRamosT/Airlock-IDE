// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { TerminalGrantModal } from "./TerminalGrantModal";

const initialState = useApp.getState();
const resolveSpy = vi.fn(() => Promise.resolve());

beforeEach(() => {
  resolveSpy.mockClear();
  window.airlock = new Proxy(
    { terminalGrantResolve: resolveSpy },
    {
      get: (t, p) =>
        (t as Record<string, unknown>)[p as string] ??
        (() => Promise.resolve(undefined)),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
  useApp.setState({
    modal: {
      grantTerminal: {
        requestId: "r1",
        ptyId: "p1",
        label: "myproj",
        preview: "fix tests",
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("Allow resolves the grant as granted and closes", async () => {
  const { getByText } = render(<TerminalGrantModal />);
  fireEvent.click(getByText("Allow for this terminal"));
  expect(resolveSpy).toHaveBeenCalledWith("r1", true);
});

it("Deny resolves the grant as not-granted and closes", async () => {
  const { getByText } = render(<TerminalGrantModal />);
  fireEvent.click(getByText("Deny"));
  expect(resolveSpy).toHaveBeenCalledWith("r1", false);
});

it("renders the project label and the input preview", () => {
  const { getByText } = render(<TerminalGrantModal />);
  expect(getByText(/myproj/)).toBeTruthy();
  expect(getByText(/fix tests/)).toBeTruthy();
});
