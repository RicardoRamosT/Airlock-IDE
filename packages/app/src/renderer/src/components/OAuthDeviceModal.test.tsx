// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OAuthBeginResult } from "../../../shared/ipc";
import { useApp } from "../store";
import { OAuthDeviceModal } from "./OAuthDeviceModal";

let resultCb:
  | ((e: { id: string; ok: boolean; error?: string }) => void)
  | null = null;
let oauthBegin: ReturnType<typeof vi.fn>;
let setConfig: ReturnType<typeof vi.fn>;

afterEach(() => {
  cleanup();
  useApp.setState({ modal: null });
  resultCb = null;
});

function mount(
  root: string | null,
  beginResult: OAuthBeginResult,
  ext: { id: string; name: string; manage?: boolean } = {
    id: "github",
    name: "GitHub",
  },
  cfg: Record<string, unknown> = {},
) {
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    activeTabId: t1,
    tabState: { ...useApp.getState().tabState, [t1]: { root } as never },
    modal: { oauthDevice: ext },
  });
  oauthBegin = vi.fn(async () => beginResult);
  setConfig = vi.fn(async () => ({}));
  (window as unknown as { airlock: Record<string, unknown> }).airlock = {
    extensionsOAuthBegin: oauthBegin,
    extensionsGetConfig: vi.fn(async () => cfg),
    extensionsSetConfig: setConfig,
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

it("manage mode: does not auto-begin; shows current workspace pre-filled", async () => {
  mount(
    "/proj",
    { kind: "browser" },
    { id: "slack", name: "Slack", manage: true },
    { workspace: { id: "T1", name: "Acme" } },
  );
  render(<OAuthDeviceModal />);
  expect(await screen.findByText(/Current workspace: Acme/i)).toBeTruthy();
  expect(oauthBegin).not.toHaveBeenCalled();
  const input = (await screen.findByPlaceholderText(
    /T0123ABCD/i,
  )) as HTMLInputElement;
  expect(input.value).toBe("T1");
});

it("manage mode: saves the workspace pin then opens the browser", async () => {
  mount(
    "/proj",
    { kind: "browser" },
    { id: "slack", name: "Slack", manage: true },
    { workspace: { id: "T1", name: "Acme" } },
  );
  render(<OAuthDeviceModal />);
  const input = (await screen.findByPlaceholderText(
    /T0123ABCD/i,
  )) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: "T2NEWTEAM" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Open browser to switch"));
  });
  expect(setConfig).toHaveBeenCalledWith("/proj", "slack", {
    workspacePin: "T2NEWTEAM",
  });
  expect(oauthBegin).toHaveBeenCalled();
  // Both calls are asserted above, so each invocationCallOrder[0] exists.
  // biome-ignore lint/style/noNonNullAssertion: calls asserted above
  expect(setConfig.mock.invocationCallOrder[0]!).toBeLessThan(
    // biome-ignore lint/style/noNonNullAssertion: calls asserted above
    oauthBegin.mock.invocationCallOrder[0]!,
  );
});
