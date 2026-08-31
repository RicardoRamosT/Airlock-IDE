// The REAL host, not the fake one the rest of agent-requests.test.ts installs.
//
// Why a separate file: that suite calls setRequestHost(fakeHost()) in a
// beforeEach, whose pickWindow is `() => live[0]`. Every branch of the electron
// host was therefore unexercised, and a request addressed to Atlas's chat
// window -- a window broadcast() never sends to and which mounts no
// AgentRequestStack -- looked fine in tests while being invisible in the app.
import { beforeEach, describe, expect, it, vi } from "vitest";

const focused = { value: null as { id: number } | null };
const appWins: { id: number }[] = [];
const rootWin = { value: null as { id: number } | null };
const appIds = new Set<number>();

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => focused.value,
    fromId: () => null,
  },
  ipcMain: { handle: () => {}, on: () => {} },
}));

vi.mock("./window", () => ({
  appWindows: () => appWins,
  isAppWindow: (id: number) => appIds.has(id),
  windowForRoot: () => rootWin.value,
}));

const { electronHost } = await import("./agent-requests");

beforeEach(() => {
  focused.value = null;
  rootWin.value = null;
  appWins.length = 0;
  appIds.clear();
});

// Two app windows, plus an Atlas window that is deliberately NOT an app window.
function scene() {
  appWins.push({ id: 1 }, { id: 2 });
  appIds.add(1);
  appIds.add(2);
}
const ATLAS_WINDOW = { id: 99 };

describe("electronHost.pickWindow", () => {
  it("prefers the window already showing the request's project", () => {
    scene();
    rootWin.value = { id: 2 };
    focused.value = { id: 1 };
    expect(electronHost.pickWindow("/p/airlock")).toBe(2);
  });

  it("uses the focused window when it is an app window", () => {
    scene();
    focused.value = { id: 2 };
    expect(electronHost.pickWindow(null)).toBe(2);
  });

  it("NEVER targets Atlas's window, which renders no request stack", () => {
    // The defect: a grant created while Atlas's chat window was focused was
    // addressed to id 99. broadcast() iterates appWindows(), so 99 was never
    // sent the projection, and no app window matched targetWindowId either --
    // the card existed in main and appeared nowhere, then expired silently.
    scene();
    focused.value = ATLAS_WINDOW;
    const picked = electronHost.pickWindow(null);
    expect(picked).not.toBe(99);
    expect(picked).toBe(1); // falls through to a real app window
  });

  it("still falls back to an app window when nothing is focused", () => {
    scene();
    focused.value = null;
    expect(electronHost.pickWindow(null)).toBe(1);
  });

  it("returns null when the only window open is Atlas's", () => {
    // No app window exists, so there is nowhere to render a card. The callers
    // treat null as "do not create the request" rather than queueing one that
    // nobody can answer.
    focused.value = ATLAS_WINDOW;
    expect(electronHost.pickWindow(null)).toBeNull();
  });

  it("every window it can return is one broadcast() will send to", () => {
    // The property that actually matters, asserted rather than the three
    // literals above: pickWindow's result must always be in windowIds().
    scene();
    for (const f of [ATLAS_WINDOW, { id: 1 }, { id: 2 }, null]) {
      focused.value = f;
      const picked = electronHost.pickWindow(null);
      if (picked !== null) expect(electronHost.windowIds()).toContain(picked);
    }
  });
});
