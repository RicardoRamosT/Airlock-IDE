// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OAuthBeginResult, OAuthResultEvent } from "../../../shared/ipc";
import { useApp } from "../store";
import { OAuthDeviceModal } from "./OAuthDeviceModal";

let resultCb: ((e: OAuthResultEvent) => void) | null = null;
let oauthBegin: ReturnType<typeof vi.fn>;
let setConfig: ReturnType<typeof vi.fn>;

const WORKSPACES = [
  { id: "T0AIRLOCK1", name: "Airlock", domain: "airlockespacio" },
  { id: "T0VIEWNEAR", name: "Viewnear", domain: "viewnear" },
];

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
  workspaces: { id: string; name: string; domain: string }[] = WORKSPACES,
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
    slackLocalWorkspaces: vi.fn(async () => workspaces),
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

const SLACK = { id: "slack", name: "Slack" };

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

it("slack: does NOT auto-open the browser; lists local workspaces by name", async () => {
  mount("/proj", { kind: "browser" }, SLACK);
  render(<OAuthDeviceModal />);
  expect(await screen.findByText("Airlock")).toBeTruthy();
  expect(screen.getByText("viewnear.slack.com")).toBeTruthy();
  expect(oauthBegin).not.toHaveBeenCalled();
});

it("slack: picking a workspace saves id + domain + name, then opens the browser", async () => {
  mount("/proj", { kind: "browser" }, SLACK);
  render(<OAuthDeviceModal />);
  // Resolve the row BEFORE act(): a findBy inside act() can't flush the state
  // update the query is waiting on.
  const row = await screen.findByText("Airlock");
  await act(async () => {
    fireEvent.click(row);
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Open Airlock in your browser"));
  });
  expect(setConfig).toHaveBeenCalledWith("/proj", "slack", {
    workspacePin: "T0AIRLOCK1",
    workspacePinDomain: "airlockespacio",
    workspacePinName: "Airlock",
  });
  expect(oauthBegin).toHaveBeenCalled();
  // Both calls are asserted above, so each invocationCallOrder[0] exists.
  // biome-ignore lint/style/noNonNullAssertion: calls asserted above
  expect(setConfig.mock.invocationCallOrder[0]!).toBeLessThan(
    // biome-ignore lint/style/noNonNullAssertion: calls asserted above
    oauthBegin.mock.invocationCallOrder[0]!,
  );
});

// Regression: the row's only selected-state was a border-colour change and the
// action button's label never moved, so clicking a workspace read as "nothing
// happened". Selection must be visible in the row AND named on the button.
it("slack: clicking a workspace visibly selects it and renames the action", async () => {
  mount("/proj", { kind: "browser" }, SLACK);
  const { container } = render(<OAuthDeviceModal />);
  const row = await screen.findByText("Airlock");
  expect(screen.getByText("Open Slack to approve")).toBeTruthy();
  expect(container.querySelector(".oauth-ws-row.on")).toBeNull();

  await act(async () => {
    fireEvent.click(row);
  });

  const on = container.querySelector(".oauth-ws-row.on");
  expect(on?.textContent).toContain("Airlock");
  expect(on?.getAttribute("aria-pressed")).toBe("true");
  expect(on?.querySelector(".codicon-circle-filled")).toBeTruthy();
  expect(screen.getByText("Open Airlock in your browser")).toBeTruthy();
  expect(screen.queryByText("Open Slack to approve")).toBeNull();

  // Picking the other row moves the selection rather than adding a second one.
  await act(async () => {
    fireEvent.click(screen.getByText("Viewnear"));
  });
  expect(container.querySelectorAll(".oauth-ws-row.on").length).toBe(1);
  expect(screen.getByText("Open Viewnear in your browser")).toBeTruthy();
});

it("slack: the paste fallback saves the raw text with no domain or name", async () => {
  mount("/proj", { kind: "browser" }, SLACK);
  render(<OAuthDeviceModal />);
  const more = await screen.findByText("Not listed? Paste your Slack URL");
  await act(async () => {
    fireEvent.click(more);
  });
  const input = screen.getByPlaceholderText(
    /slack\.com or T0123ABCD/i,
  ) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, {
      target: { value: "ricardos-test-workspace.slack.com" },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Open Slack to approve"));
  });
  expect(setConfig).toHaveBeenCalledWith("/proj", "slack", {
    workspacePin: "ricardos-test-workspace.slack.com",
    workspacePinDomain: "",
    workspacePinName: "",
  });
});

it("slack: with no local Slack app, only the paste fallback shows", async () => {
  mount("/proj", { kind: "browser" }, SLACK, {}, []);
  render(<OAuthDeviceModal />);
  expect(
    await screen.findByText(/No local Slack workspaces found/i),
  ).toBeTruthy();
  expect(screen.getByPlaceholderText(/slack\.com or T0123ABCD/i)).toBeTruthy();
  expect(screen.queryByText("Not listed? Paste your Slack URL")).toBeNull();
});

it("slack: closes on a clean (no-mismatch) success", async () => {
  mount("/proj", { kind: "browser" }, SLACK);
  render(<OAuthDeviceModal />);
  const row = await screen.findByText("Airlock");
  await act(async () => {
    fireEvent.click(row);
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Open Airlock in your browser"));
  });
  expect(
    await screen.findByText(/Opening your browser to sign in to Slack/i),
  ).toBeTruthy();
  expect(document.querySelector(".oauth-code")).toBeNull();
  await act(async () =>
    resultCb?.({
      id: "slack",
      ok: true,
      workspace: {
        id: "T0AIRLOCK1",
        name: "Airlock",
        domain: "airlockespacio",
      },
      requested: {
        teamId: "T0AIRLOCK1",
        domain: "airlockespacio",
        name: "Airlock",
      },
      mismatch: false,
    }),
  );
  expect(useApp.getState().modal).toBeNull();
});

it("slack: toggling the private-access opt-in persists includePrivate", async () => {
  mount("/proj", { kind: "browser" }, SLACK);
  render(<OAuthDeviceModal />);
  const box = (await screen.findByLabelText(
    /Include private channels/i,
  )) as HTMLInputElement;
  expect(box.checked).toBe(false);
  await act(async () => {
    fireEvent.click(box);
  });
  expect(setConfig).toHaveBeenCalledWith("/proj", "slack", {
    includePrivate: true,
  });
});

it("manage mode: shows the current workspace and pre-fills a pin the picker can't show", async () => {
  mount(
    "/proj",
    { kind: "browser" },
    { ...SLACK, manage: true },
    { workspace: { id: "T0BGEUK686M", name: "Ricardo's Test Workspace" } },
  );
  render(<OAuthDeviceModal />);
  expect(
    await screen.findByText(/Current workspace: Ricardo's Test Workspace/i),
  ).toBeTruthy();
  expect(oauthBegin).not.toHaveBeenCalled();
  // The saved pin matches no picker row, so the fallback opens pre-filled
  // rather than silently dropping it.
  const input = (await screen.findByPlaceholderText(
    /slack\.com or T0123ABCD/i,
  )) as HTMLInputElement;
  expect(input.value).toBe("T0BGEUK686M");
  expect(screen.getByText("Open browser to switch")).toBeTruthy();
});

const MISMATCH: OAuthResultEvent = {
  id: "slack",
  ok: true,
  workspace: { id: "T0AIRLOCK1", name: "Airlock", domain: "airlockespacio" },
  requested: {
    teamId: "T0BGEUK686M",
    domain: "",
    name: "Ricardo's Test Workspace",
  },
  mismatch: true,
};

async function reachMismatch() {
  mount("/proj", { kind: "browser" }, SLACK);
  render(<OAuthDeviceModal />);
  const row = await screen.findByText("Airlock");
  await act(async () => {
    fireEvent.click(row);
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Open Airlock in your browser"));
  });
  await act(async () => resultCb?.(MISMATCH));
}

it("mismatch: stays open and names both workspaces", async () => {
  await reachMismatch();
  expect(useApp.getState().modal).not.toBeNull();
  expect(screen.getByText(/Connected to “Airlock”/i).textContent).toContain(
    "Ricardo's Test Workspace",
  );
  expect(
    screen.getByText(
      /Slack authorized the workspace your browser was signed into/i,
    ),
  ).toBeTruthy();
  // The chooser is replaced, so there is exactly one call to action.
  expect(screen.queryByText("Reopen browser")).toBeNull();
});

it("mismatch: Keep adopts the connected workspace as the new pin and closes", async () => {
  await reachMismatch();
  await act(async () => {
    fireEvent.click(screen.getByText("Keep Airlock"));
  });
  expect(setConfig).toHaveBeenLastCalledWith("/proj", "slack", {
    workspacePin: "T0AIRLOCK1",
    workspacePinDomain: "airlockespacio",
    workspacePinName: "Airlock",
  });
  expect(useApp.getState().modal).toBeNull();
});

it("mismatch: Try again reopens the flow without changing the pin", async () => {
  await reachMismatch();
  const before = setConfig.mock.calls.length;
  await act(async () => {
    fireEvent.click(screen.getByText("Try again"));
  });
  expect(setConfig.mock.calls.length).toBe(before);
  expect(oauthBegin).toHaveBeenCalledTimes(2);
  expect(useApp.getState().modal).not.toBeNull();
});

it("no request made: a connected workspace is recorded, never a mismatch", async () => {
  mount("/proj", { kind: "browser" }, SLACK, {}, []);
  render(<OAuthDeviceModal />);
  const go = await screen.findByText("Open Slack to approve");
  await act(async () => {
    fireEvent.click(go);
  });
  await act(async () =>
    resultCb?.({
      id: "slack",
      ok: true,
      workspace: {
        id: "T0AIRLOCK1",
        name: "Airlock",
        domain: "airlockespacio",
      },
      requested: { teamId: "", domain: "", name: "" },
      mismatch: false,
    }),
  );
  expect(useApp.getState().modal).toBeNull();
});
