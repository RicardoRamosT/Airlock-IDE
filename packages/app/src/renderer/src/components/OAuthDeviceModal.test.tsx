// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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

function mount(root: string | null) {
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    activeTabId: t1,
    tabState: { ...useApp.getState().tabState, [t1]: { root } as never },
    modal: { oauthDevice: { id: "github", name: "GitHub" } },
  });
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsOAuthBegin: vi.fn(async () => ({
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
    })),
    onExtensionOAuthResult: (cb: typeof resultCb) => {
      resultCb = cb;
      return () => {};
    },
    hostOpenExternal: vi.fn(),
  };
}

it("shows the device code and closes on a matching successful result", async () => {
  mount("/proj");
  render(<OAuthDeviceModal />);
  expect(await screen.findByText("WXYZ-1234")).toBeTruthy();
  await act(async () => resultCb?.({ id: "github", ok: true }));
  expect(useApp.getState().modal).toBeNull();
});

it("shows the error and stays open on a failed result", async () => {
  mount("/proj");
  render(<OAuthDeviceModal />);
  await screen.findByText("WXYZ-1234");
  await act(async () =>
    resultCb?.({ id: "github", ok: false, error: "Access was denied." }),
  );
  expect(screen.getByText("Access was denied.")).toBeTruthy();
  expect(useApp.getState().modal).not.toBeNull();
});
