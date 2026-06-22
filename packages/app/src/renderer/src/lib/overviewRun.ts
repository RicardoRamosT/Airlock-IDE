// Pure decision for the Overview "Generate" action. Mirrors how
// sendToClaudeTerminal resolves a target (claudeAutoId ?? activeTerminalId);
// "spawn" means there is no live pty to send to (distinguishing a bare shell
// from a running Claude is out of scope, same as today's behavior).
export interface TabTerminalsLike {
  terminals: { id: string; ptyId: string | null }[];
  activeTerminalId: string | null;
  claudeAutoId: string | null;
}

export type OverviewRunPlan =
  | { mode: "reuse"; termId: string; ptyId: string; busy: boolean }
  | { mode: "spawn" };

export type OverviewRunResult = "submitted" | "spawning";

export function planOverviewRun(
  tt: TabTerminalsLike | undefined,
  sessionWorking: Record<string, boolean>,
): OverviewRunPlan {
  if (!tt) return { mode: "spawn" };
  const termId = tt.claudeAutoId ?? tt.activeTerminalId;
  if (!termId) return { mode: "spawn" };
  const ptyId = tt.terminals.find((t) => t.id === termId)?.ptyId ?? null;
  if (!ptyId) return { mode: "spawn" };
  return { mode: "reuse", termId, ptyId, busy: Boolean(sessionWorking[ptyId]) };
}
