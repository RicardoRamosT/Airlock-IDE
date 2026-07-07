// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OAuthBeginResult } from "../../../shared/ipc";
import { useApp } from "../store";
import { OAuthDeviceModal } from "./OAuthDeviceModal";

let resultCb:
  | ((e: { id: string; ok: boolean; error?: string }) => void)
  | null = null;

afterEach(() => {
  cleanup();
  useApp.setState({ modal: null });
  resultCb = null;
});

function mount(
  root: string | null,
  begin: OAuthBeginResult,
  ext = { id: "github", name: "GitHub" },
) {
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    activeTabId: t1,
    tabState: { ...useApp.getState().tabState, [t1]: { root } as never },
    modal: { oauthDevice: ext },
  });
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsOAuthBegin: vi.fn(async () => begin),
    onExtensionOAuthResult: (cb: typeof resultCb) => {
      resultCb = cb;
      return () => {};
    },
    hostOpenExternal: vi.fn(),
  };
}

const DEVICE: OAuthBeginResult = {
  kind: "device",
  userCode: "WXYZ-1234",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
};

it("device flow: shows the code and closes on a matching success", async () => {
  mount("/proj", DEVICE);
  render(<OAuthDeviceModal />);
  expect(await screen.findByText("WXYZ-1234")).toBeTruthy();
  await act(async () => resultCb?.({ id: "github", ok: true }));
  expect(useApp.getState().modal).toBeNull();
});

it("device flow: shows the error and stays open on a failed result", async () => {
  mount("/proj", DEVICE);
  render(<OAuthDeviceModal />);
  await screen.findByText("WXYZ-1234");
  await act(async () =>
    resultCb?.({ id: "github", ok: false, error: "Access was denied." }),
  );
  expect(screen.getByText("Access was denied.")).toBeTruthy();
  expect(useApp.getState().modal).not.toBeNull();
});

it("broker flow: shows the browser waiting state (no code), closes on success", async () => {
  mount("/proj", { kind: "browser" }, { id: "slack", name: "Slack" });
  render(<OAuthDeviceModal />);
  expect(
    await screen.findByText(/Opening your browser to sign in to Slack/i),
  ).toBeTruthy();
  expect(document.querySelector(".oauth-code")).toBeNull();
  await act(async () => resultCb?.({ id: "slack", ok: true }));
  expect(useApp.getState().modal).toBeNull();
});
