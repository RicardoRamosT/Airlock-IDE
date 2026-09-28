import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useApp } from "../store";
import { applyCommand } from "./useAgentCommands";

// WHICH TAB start_dev_server LANDS IN.
//
// Observed 2026-09-28: Trackview's Claude called start_dev_server while the
// user was working in lendlogic-baapp. Main resolved the caller correctly
// (Trackview, from its MCP token) and then dropped it on the way here, so the
// renderer used the FOCUSED tab: a terminal opened in lendlogic-baapp -- with
// that project's vaulted secrets injected by pty:create -- and ran
// lendlogic-baapp's whole dev stack under lendlogic-baapp's Host. Trackview
// stayed idle, and the agent reported that nothing had started anywhere.

const initialState = useApp.getState();
let registered: unknown[][];

beforeEach(() => {
  registered = [];
  // Node env has no window. Any airlock call these tests do not care about is
  // a resolved no-op; devServerRegister is recorded, because WHICH ROOT it
  // registers is the whole question.
  const airlock: Record<string, unknown> = {
    devServerRegister: async (...args: unknown[]) => {
      registered.push(args);
    },
  };
  (globalThis as { window?: unknown }).window = {
    airlock: new Proxy(airlock, {
      get: (t, k: string) => (k in t ? t[k] : () => Promise.resolve()),
    }),
  };
  useApp.setState(initialState, true);
});
afterEach(() => useApp.setState(initialState, true));

const openProjectTab = (root: string): string => {
  useApp.getState().openProject(root);
  return useApp.getState().activeTabId;
};

const terminalIds = (tabId: string): string[] =>
  (useApp.getState().tabTerminals[tabId]?.terminals ?? []).map((t) => t.id);

// Stand in for TerminalPane: every terminal gets a pty once it mounts.
function adoptPtys(): void {
  for (const tt of Object.values(useApp.getState().tabTerminals))
    for (const t of tt.terminals)
      if (!t.ptyId) useApp.getState().setTerminalPty(t.id, `pty-${t.id}`);
}

const START = {
  type: "start_dev_server",
  command: "npm run dev",
  startedBy: "agent",
} as const;

describe("start_dev_server", () => {
  it("starts in the CALLER's project, not the focused one", async () => {
    const trackview = openProjectTab("/p/Trackview");
    const lendlogic = openProjectTab("/p/lendlogic-baapp"); // focused
    const before = terminalIds(lendlogic);

    const done = applyCommand(START, "/p/Trackview");
    adoptPtys();
    await done;

    expect(terminalIds(lendlogic)).toEqual(before);
    expect(terminalIds(trackview)).toHaveLength(1);
    expect(registered.map((a) => a[0])).toEqual(["/p/Trackview"]);
    // The dev command is queued for Trackview's new terminal, nowhere else.
    const [termId] = terminalIds(trackview);
    expect(useApp.getState().pendingTerminalCommands).toEqual({
      [termId as string]: "npm run dev\n",
    });
  });

  it("does not pull the screen away from the project being worked in", async () => {
    openProjectTab("/p/Trackview");
    const lendlogic = openProjectTab("/p/lendlogic-baapp");

    const done = applyCommand(START, "/p/Trackview");
    adoptPtys();
    await done;

    expect(useApp.getState().activeTabId).toBe(lendlogic);
  });

  it("refuses, and starts nothing, when the caller's project has no tab here", async () => {
    const lendlogic = openProjectTab("/p/lendlogic-baapp");
    const before = terminalIds(lendlogic);

    const done = applyCommand(START, "/p/Trackview");
    adoptPtys();

    await expect(done).rejects.toThrow(/no tab open/);
    expect(terminalIds(lendlogic)).toEqual(before);
    expect(registered).toEqual([]);
  });
});
