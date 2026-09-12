// @vitest-environment jsdom
//
// The gate on AirLock's other security posture. injectSecretsIntoTerminal puts
// every vaulted value into every terminal's environment and takes redaction off
// that path entirely, so ENABLING it must ask and must not write anything until
// the user says yes. DISABLING restores the default, which is safe, so it must
// NOT ask -- a confirm there is friction with nothing behind it.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SecretMeta } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useApp } from "../store";
import { SecretsSection } from "./SecretsSection";

const initialState = useApp.getState();
const ROOT = "/workspace";
const METAS = [{ name: "TEST", valid: true }] as SecretMeta[];

let configSet: ReturnType<typeof vi.fn>;

function mount(injected: boolean) {
  configSet = vi.fn((_root: string, patch: Record<string, unknown>) =>
    Promise.resolve(patch),
  );
  window.airlock = new Proxy(
    {
      secretsList: () => Promise.resolve(METAS),
      configGet: () => Promise.resolve({ injectSecretsIntoTerminal: injected }),
      onSecretsChanged: () => () => {},
      configSet,
    },
    {
      get: (target, prop) =>
        prop in target
          ? (target as Record<string, unknown>)[prop as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);

  const tabId = useApp.getState().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  const cur = useApp.getState().tabState[tabId];
  if (!cur) throw new Error("no tabState");
  useApp.setState({
    tabState: {
      ...useApp.getState().tabState,
      [tabId]: { ...cur, root: ROOT },
    },
  });
  return render(
    <ProjectPaneContext.Provider value={tabId}>
      <SecretsSection />
    </ProjectPaneContext.Provider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it("asks before turning injection ON, and writes nothing until confirmed", async () => {
  mount(false);
  fireEvent.click(await screen.findByText("Secrets in terminals"));
  // The confirm is up...
  expect(screen.getByText("Put secrets in every terminal?")).toBeTruthy();
  // ...and nothing has been written yet. This is the half that matters: a
  // dialog that fires the change before you answer it is not a gate.
  expect(configSet).not.toHaveBeenCalled();
});

it("writes only after the confirm is accepted", async () => {
  mount(false);
  fireEvent.click(await screen.findByText("Secrets in terminals"));
  fireEvent.click(screen.getByText("Turn on"));
  expect(configSet).toHaveBeenCalledWith(ROOT, {
    injectSecretsIntoTerminal: true,
  });
});

it("cancelling leaves the posture alone", async () => {
  mount(false);
  fireEvent.click(await screen.findByText("Secrets in terminals"));
  fireEvent.click(screen.getByText("Cancel"));
  expect(configSet).not.toHaveBeenCalled();
  expect(screen.queryByText("Put secrets in every terminal?")).toBeNull();
});

it("turning it OFF does not ask -- that direction is safe", async () => {
  mount(true);
  fireEvent.click(await screen.findByText("Secrets in terminals"));
  expect(screen.queryByText("Put secrets in every terminal?")).toBeNull();
  expect(configSet).toHaveBeenCalledWith(ROOT, {
    injectSecretsIntoTerminal: false,
  });
});
