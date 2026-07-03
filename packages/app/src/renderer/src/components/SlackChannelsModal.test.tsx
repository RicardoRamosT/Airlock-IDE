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
import { SlackChannelsModal } from "./SlackChannelsModal";

afterEach(() => {
  cleanup();
  useApp.setState({ modal: null });
});

function withRoot(root: string) {
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    activeTabId: t1,
    tabState: { ...useApp.getState().tabState, [t1]: { root } as never },
    modal: "slack-channels",
  });
}

it("loads channels + current allow-list and saves the checked set", async () => {
  const extensionsSetConfig = vi.fn(async () => ({}));
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsSlackChannels: vi.fn(async () => [
      { id: "C1", name: "bugs", isPrivate: false },
      { id: "C2", name: "eng", isPrivate: false },
    ]),
    extensionsGetConfig: vi.fn(async () => ({
      channels: [{ id: "C1", name: "bugs" }],
    })),
    extensionsSetConfig,
  };
  withRoot("/proj");

  render(<SlackChannelsModal />);
  // Channels load; #bugs starts checked (already allow-listed), #eng unchecked.
  const bugs = (await screen.findByText(/bugs/)).closest("label");
  const eng = screen.getByText(/eng/).closest("label");
  expect(bugs?.querySelector("input")?.checked).toBe(true);
  expect(eng?.querySelector("input")?.checked).toBe(false);

  // Allow #eng too, then save.
  const engBox = eng?.querySelector("input");
  if (!engBox) throw new Error("no eng checkbox");
  fireEvent.click(engBox);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });

  expect(extensionsSetConfig).toHaveBeenCalledWith("/proj", "slack", {
    channels: [
      { id: "C1", name: "bugs" },
      { id: "C2", name: "eng" },
    ],
  });
  expect(useApp.getState().modal).toBeNull(); // closed on save
});
