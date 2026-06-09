// @vitest-environment jsdom
//
// White-screen guard. The rest of the suite runs in environment:"node" (see
// vitest.config.ts), which has no DOM and so never actually RENDERS React --
// the recent blank-window crash (an unstable ref-callback -> setState loop in
// the terminal-slot registry) sailed through every gate because nothing mounted
// <App/>. This file opts into jsdom (the docblock above) and mounts the real
// <App/> against a stubbed window.airlock. @testing-library/react's render()
// wraps act(), so effects + ref callbacks run for real; a render throw or a
// "Maximum update depth exceeded" loop fails the test instead of shipping a
// white screen.
//
// The App/ProjectPane/TerminalManager/terminalSlots portal path -- exactly the
// code that crashed -- runs UNMOCKED here. Only the xterm leaf is mocked: its
// Terminal.open() measures a real canvas/DOM that jsdom does not provide, so a
// minimal stub stands in for the @xterm packages (and ONLY those) while every
// layer above the TerminalPane host renders for real.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppPrefs } from "../../shared/ipc";
import { App } from "./App";
import { useApp } from "./store";

// --- xterm leaf mock (jsdom has no canvas / text-measurement) ---------------
// TerminalPane news up a Terminal and calls loadAddon/open/write/onData/
// onTitleChange/dispose plus reads buffer/cols/rows; the working-indicator scan
// reads buffer.active.getLine(...).translateToString(...). open() needs a real
// rendering surface jsdom lacks, so we replace the @xterm packages with the
// smallest stub that satisfies those calls. Everything ABOVE the host div
// (App -> ProjectPane -> TerminalManager portal -> ProjectTerminals ->
// TerminalPane mount) still runs for real -- that is the bug class we guard.
vi.mock("@xterm/xterm", () => {
  class Terminal {
    cols = 80;
    rows = 24;
    options: { theme?: unknown } = {};
    buffer = {
      active: {
        length: 0,
        getLine: () => ({ translateToString: () => "" }),
      },
    };
    loadAddon() {}
    open() {}
    write(_data: string, cb?: () => void) {
      cb?.();
    }
    onData() {
      return { dispose() {} };
    }
    onTitleChange() {
      return { dispose() {} };
    }
    dispose() {}
  }
  return { Terminal };
});

vi.mock("@xterm/addon-fit", () => {
  class FitAddon {
    fit() {}
  }
  return { FitAddon };
});

// --- window.airlock stub ----------------------------------------------------
// A full AppPrefs (matches main/prefs.ts DEFAULTS + shared/ipc AppPrefs). The
// mount's usePrefs reads these fields to hydrate the layout store; mcp is
// optional and deliberately omitted, exactly like the real defaults.
const DEFAULT_PREFS: AppPrefs = {
  sidebarVisible: true,
  sidebarPosition: "left",
  theme: "dark",
  sectionVisibility: {
    files: true,
    secrets: true,
    git: true,
    activity: true,
    databases: true,
    docker: true,
    host: true,
    audit: true,
  },
  activeView: "files",
  clipboardClearSeconds: 30,
  openProjectsAsTabs: true,
  showRunningProcessNotice: true,
  recentFolders: [],
  agentPolicy: {
    network: "allow",
    outsideWorkspace: "ask",
    destructive: "ask",
    privilege: "block",
  },
  quotaMeter: { enabled: false },
};

// Only the methods whose RESOLVED SHAPE the mount destructures need an explicit
// override (everything else is covered by the Proxy default below). Shapes are
// copied from shared/ipc.ts AirlockApi so no mount-time access reads a wrong
// shape. Note: the mount-time IPC surface is small (most sidebar sections are
// defaultOpen={false} and never mount), but these cover the ones that do plus
// the store/hook hydrate path.
// Counters for the pty-preservation test: a terminal is torn down (ptyKill) only
// when its TerminalPane unmounts, so "ptyKill not called across a split toggle"
// proves the terminals did NOT remount (the portal-remount bug this guards).
let ptyCreateCalls = 0;
let ptyKillCalls = 0;

const overrides: Record<string, unknown> = {
  prefsGet: () => Promise.resolve(DEFAULT_PREFS),
  gitIsRepo: () => Promise.resolve(false),
  gitStatus: () => Promise.resolve(null),
  activityStatus: () => Promise.resolve([]),
  // dockerList (not dockerStatus) is the real method; returns this 3-field shape.
  dockerList: () =>
    Promise.resolve({ installed: false, running: false, containers: [] }),
  renderStatus: () => Promise.resolve({ connected: false }),
  neonStatus: () => Promise.resolve({ connected: false }),
  ptyCreate: () => Promise.resolve(`pty-smoke-${++ptyCreateCalls}`),
  ptyKill: () => {
    ptyKillCalls += 1;
    return Promise.resolve(undefined);
  },
  workspaceRoots: () => Promise.resolve(undefined),
};

// jsdom does not implement ResizeObserver, which TerminalPane's mount effect
// constructs to refit xterm on layout changes. Polyfill a no-op so that effect
// runs for real (we are guarding the mount, not resize behavior); this is an
// environment gap, not app code under test.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function installAirlockStub(): void {
  window.airlock = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        // Explicit shape override wins; else "on*" is a subscription (must
        // return an unsubscribe fn); everything else is a Promise<undefined>.
        overrides[prop] ??
        (prop.startsWith("on")
          ? () => () => {}
          : () => Promise.resolve(undefined)),
    },
  ) as unknown as typeof window.airlock;
}

beforeEach(() => {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
  installAirlockStub();
  ptyCreateCalls = 0;
  ptyKillCalls = 0;
});

afterEach(() => {
  cleanup();
});

it("mounts <App/> without crashing (white-screen guard)", async () => {
  const { container, findByText } = render(<App />);
  // The custom titlebar shows the app name -> proves the chrome rendered (not a
  // blank window). findByText also flushes pending effects/microtasks.
  await findByText(/airlock/i);
  // The outermost shell div is present -> the App tree mounted, not an error
  // boundary / empty body.
  expect(container.querySelector(".app-shell")).toBeTruthy();
  // The pane + the once-mounted TerminalManager keep-alive both rendered: this
  // is the App -> ProjectPane -> TerminalManager portal path that white-screened
  // last time (slotRef register/unregister -> setState loop). If it looped,
  // render() would have thrown "Maximum update depth exceeded" above.
  expect(container.querySelector(".project-pane")).toBeTruthy();
  expect(container.querySelector(".terminal-keepalive")).toBeTruthy();
});

it("keeps terminals alive across a split toggle (no pty teardown)", async () => {
  render(<App />);
  // Let the initial blank tab's terminal mount + adopt its pty.
  await act(async () => {});
  ptyKillCalls = 0; // measure only the toggle, not any mount churn

  // Toggle split ON: adds a blank secondary pane + shows the split. The existing
  // terminal must NOT be torn down. Re-targeting a portal (the old bug) would
  // remount TerminalPane and call ptyKill here, closing the running session.
  await act(async () => {
    useApp.getState().toggleProjectSplit();
  });
  expect(ptyKillCalls).toBe(0);

  // Toggle split OFF: the second pane's terminal relocates to the hidden
  // keep-alive (appendChild), still mounted -- not killed.
  await act(async () => {
    useApp.getState().toggleProjectSplit();
  });
  expect(ptyKillCalls).toBe(0);

  // Sanity: terminals WERE created (the guard is meaningful, not vacuous).
  expect(ptyCreateCalls).toBeGreaterThan(0);
});
