import { afterEach, beforeEach, expect, it } from "vitest";
import { claudeAutoCommand, useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => {
  // openProject reports open roots over IPC; node env has no window. Same
  // stub pattern as commands.test.ts.
  (globalThis as { window?: unknown }).window = {
    airlock: { workspaceRoots: () => Promise.resolve() },
  };
  useApp.setState(initialState, true);
});
afterEach(() => useApp.setState(initialState, true));

// The launch tab is BLANK (root null). Give it a project root via openProject
// (which creates a NEW tab with fresh tabTerminals) so decisions apply.
const openProjectTab = (root: string): string => {
  useApp.getState().openProject(root);
  return useApp.getState().activeTabId;
};

it("exports the exact command the Start-Claude-here button uses", () => {
  // env -u strips a project-injected ANTHROPIC_API_KEY/AUTH_TOKEN for the claude
  // process only, so AirLock's auto-claude uses the claude.ai subscription.
  expect(claudeAutoCommand(false)).toBe(
    "env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude\n",
  );
});

it("off mode never grants", () => {
  useApp.getState().setClaudeAutoStart("off");
  const tab = openProjectTab("/tmp/projA");
  const id = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(id)).toBe(false);
});

it("blank tabs never grant, regardless of mode", () => {
  useApp.getState().setClaudeAutoStart("every");
  const blankTab = useApp.getState().activeTabId; // initial tab, root null
  const id = useApp.getState().addTerminal(blankTab);
  expect(useApp.getState().claudeAutoDecision(id)).toBe(false);
});

it("every mode grants every project terminal", () => {
  useApp.getState().setClaudeAutoStart("every");
  const tab = openProjectTab("/tmp/projA");
  const a = useApp.getState().addTerminal(tab);
  const b = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true);
  expect(useApp.getState().claudeAutoDecision(b)).toBe(true);
});

it("first mode grants once per tab and is idempotent for the holder", () => {
  useApp.getState().setClaudeAutoStart("first");
  const tab = openProjectTab("/tmp/projA");
  const a = useApp.getState().addTerminal(tab);
  const b = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true);
  expect(useApp.getState().claudeAutoDecision(b)).toBe(false); // claim held by a
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true); // re-ask: still ours
});

it("first mode re-grants after the holder is removed", () => {
  useApp.getState().setClaudeAutoStart("first");
  const tab = openProjectTab("/tmp/projA");
  const a = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true);
  useApp.getState().removeTerminal(a);
  const b = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(b)).toBe(true);
});

it("claims are independent per tab", () => {
  useApp.getState().setClaudeAutoStart("first");
  const tabA = openProjectTab("/tmp/projA");
  const a = useApp.getState().addTerminal(tabA);
  const tabB = openProjectTab("/tmp/projB");
  const b = useApp.getState().addTerminal(tabB);
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true);
  expect(useApp.getState().claudeAutoDecision(b)).toBe(true);
});

it("unknown terminal ids never grant", () => {
  useApp.getState().setClaudeAutoStart("every");
  expect(useApp.getState().claudeAutoDecision("term-nope")).toBe(false);
});

it("does NOT auto-start Claude in a terminal the AGENT opened", () => {
  // open_terminal means "give me a shell to run commands in". Auto-starting
  // Claude there hands the agent a TUI instead, so its next send lands in a
  // composer and is typed but never submitted (observed 2026-08-31).
  openProjectTab("/p/airlock");
  useApp.getState().setClaudeAutoStart("every");
  const agentTerm = useApp.getState().addTerminal(undefined, {
    plainShell: true,
  });
  expect(useApp.getState().claudeAutoDecision(agentTerm)).toBe(false);
});

it("still auto-starts in a terminal the USER opened, in the same tab", () => {
  // The suppression is per-terminal, not a mode switch: opening one shell for
  // the agent must not turn auto-start off for everything after it.
  openProjectTab("/p/airlock");
  useApp.getState().setClaudeAutoStart("every");
  const agentTerm = useApp.getState().addTerminal(undefined, {
    plainShell: true,
  });
  const userTerm = useApp.getState().addTerminal();
  expect(useApp.getState().claudeAutoDecision(agentTerm)).toBe(false);
  expect(useApp.getState().claudeAutoDecision(userTerm)).toBe(true);
});

it("does not let an agent terminal hold the 'first' claim it never used", () => {
  // In "first" mode the claim is what stops a second Claude starting. An agent
  // shell must not take it, or the user's next terminal would silently lose
  // its session.
  openProjectTab("/p/airlock");
  useApp.getState().setClaudeAutoStart("first");
  const agentTerm = useApp.getState().addTerminal(undefined, {
    plainShell: true,
  });
  expect(useApp.getState().claudeAutoDecision(agentTerm)).toBe(false);
  const userTerm = useApp.getState().addTerminal();
  expect(useApp.getState().claudeAutoDecision(userTerm)).toBe(true);
});
