import { afterEach, beforeEach, expect, it } from "vitest";
import { CLAUDE_AUTO_COMMAND, useApp } from "./store";

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
  expect(CLAUDE_AUTO_COMMAND).toBe("claude\n");
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
