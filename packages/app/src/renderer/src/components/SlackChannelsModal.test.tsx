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

function stubPicker(privateAccess: boolean | null) {
  const extensionsSetConfig = vi.fn(async () => ({}));
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsSlackChannels: vi.fn(async () => [
      { id: "C1", name: "bugs", kind: "public" },
    ]),
    extensionsGetConfig: vi.fn(async () => ({})),
    extensionsSetConfig,
    extensionsSlackPrivateAccess: vi.fn(async () => privateAccess),
  };
  return extensionsSetConfig;
}

// A public-only token cannot be fixed by checking boxes here: Slack fixes the
// scopes at sign-in. Saying only "public-only" would be a shrug, so the card
// carries the one action that actually resolves it.
it("offers a re-authorize path when the token cannot read private channels", async () => {
  stubPicker(false);
  withRoot("/proj");
  render(<SlackChannelsModal />);
  expect(
    await screen.findByRole("button", {
      name: "Re-authorize with private access",
    }),
  ).toBeTruthy();
  // It must say WHY the button exists, not just offer it.
  expect(screen.getByText(/only read/)).toBeTruthy();
  // And that the consequence is workspace-wide, since this is a per-project pane.
  expect(screen.getByText(/every project using it/)).toBeTruthy();
});

it("says nothing about scopes when the token CAN read private channels", async () => {
  stubPicker(true);
  withRoot("/proj");
  render(<SlackChannelsModal />);
  await screen.findByText(/bugs/);
  expect(
    screen.queryByRole("button", { name: "Re-authorize with private access" }),
  ).toBeNull();
});

// ORDER IS LOAD-BEARING: slackScopes reads includePrivate to build the
// authorize URL, so recording the opt-in has to happen BEFORE the sign-in
// dialog opens -- otherwise the flow requests the public-only set again and
// the user ends up exactly where they started.
it("records the private opt-in BEFORE handing over to the sign-in dialog", async () => {
  const setConfig = stubPicker(false);
  withRoot("/proj");
  render(<SlackChannelsModal />);
  const btn = await screen.findByRole("button", {
    name: "Re-authorize with private access",
  });
  await act(async () => {
    fireEvent.click(btn);
  });
  expect(setConfig).toHaveBeenCalledWith("/proj", "slack", {
    includePrivate: true,
  });
  expect(useApp.getState().modal).toEqual({
    oauthDevice: { id: "slack", name: "Slack" },
  });
});

// The probe only decides whether to OFFER an upgrade. An older preload that
// does not expose it, or a failing call, must not take the picker down --
// choosing channels is the job, the probe is advice.
it("still lists channels when the private probe is unavailable", async () => {
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsSlackChannels: vi.fn(async () => [
      { id: "C1", name: "bugs", kind: "public" },
    ]),
    extensionsGetConfig: vi.fn(async () => ({})),
    extensionsSetConfig: vi.fn(async () => ({})),
    // deliberately absent: extensionsSlackPrivateAccess
  };
  withRoot("/proj");
  render(<SlackChannelsModal />);
  expect(await screen.findByText(/bugs/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Re-authorize with private access" }),
  ).toBeNull();
});
