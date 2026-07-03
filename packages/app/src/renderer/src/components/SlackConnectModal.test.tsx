// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { SlackConnectModal } from "./SlackConnectModal";

afterEach(() => {
  cleanup();
  useApp.setState({ modal: null });
});

function withRoot(root: string) {
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    activeTabId: t1,
    tabState: { ...useApp.getState().tabState, [t1]: { root } as never },
    modal: "connect-slack",
  });
}

it("connects with the pasted token, then opens the channels picker", async () => {
  const extensionsConnect = vi.fn(async () => ({ ok: true, detail: "Acme" }));
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsConnect,
  };
  withRoot("/proj");

  render(<SlackConnectModal />);
  fireEvent.change(screen.getByPlaceholderText(/xoxb/i), {
    target: { value: "xoxb-tok" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  });

  expect(extensionsConnect).toHaveBeenCalledWith("/proj", "slack", "xoxb-tok");
  // On success it advances to the allow-list picker (the wall).
  expect(useApp.getState().modal).toBe("slack-channels");
});

it("shows the provider error and stays open on failure", async () => {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsConnect: vi.fn(async () => ({
      ok: false,
      error: "invalid_auth",
    })),
  };
  withRoot("/proj");

  render(<SlackConnectModal />);
  fireEvent.change(screen.getByPlaceholderText(/xoxb/i), {
    target: { value: "bad" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  });

  expect(screen.getByText("invalid_auth")).toBeTruthy();
  expect(useApp.getState().modal).toBe("connect-slack"); // still open
});
