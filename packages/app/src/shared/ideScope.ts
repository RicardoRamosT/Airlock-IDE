// ASCII comments only. WHICH TAB an IDE-control command acts on.
//
// This is an ISOLATION BOUNDARY, so it lives in its own file with its own test,
// exactly like terminalScope.ts -- which is the rule this one mirrors.
//
// The IDE-control tools (open_tab / close_tab / switch_tab / split_view /
// open_terminal / close_terminal / open_app_page) used to resolve their target
// from the FOCUSED window and tab, and never consulted the caller at all. That
// is an isolation hole, not a nicety: a project's Claude carries a per-project
// token, so its root is known, and server.ts is explicit that "Focus
// (lastFocusedRoot) is NOT consulted for MCP requests". The layout family was
// simply not following it.
//
// Reported 2026-09-14: aparatosauditivos' Claude called open_terminal while the
// user was working in another project, and the terminal was created THERE --
// with THAT project's vaulted secrets injected into it by pty:create.
//
// Two kinds of caller, the same two terminalScope.ts names:
//
//  - A PROJECT's Claude has a root. It acts on its own project's tab and
//    nothing else, and it never takes focus away from a project the user is
//    working in.
//  - ATLAS carries no token, so its root is null. It is portfolio-wide by
//    construction and keeps the old behaviour, which is what it is for.

export interface ScopeTab {
  id: string;
  root: string | null; // null for a blank tab, which belongs to no project
}

export type CommandTarget =
  | { ok: true; tabId: string | null; focus: boolean }
  | { ok: false; error: string };

// An unknown tab and another project's tab answer THE SAME WAY, so a caller
// cannot probe for tabs in projects it may not touch. Same reasoning as
// resolveTailScope's "No such terminal".
const DENY: CommandTarget = { ok: false, error: "No such tab" };

export function resolveCommandTab(
  callerRoot: string | null,
  explicitTabId: string | undefined,
  tabs: readonly ScopeTab[],
  focusedTabId: string | null,
): CommandTarget {
  // Atlas: portfolio-wide, unchanged.
  if (callerRoot === null)
    return { ok: true, tabId: explicitTabId ?? focusedTabId, focus: true };

  if (explicitTabId !== undefined) {
    const tab = tabs.find((t) => t.id === explicitTabId);
    if (!tab || tab.root !== callerRoot) return DENY;
    return { ok: true, tabId: tab.id, focus: tab.id === focusedTabId };
  }

  const own = tabs.find((t) => t.root === callerRoot);
  if (!own)
    return {
      ok: false,
      error:
        "This project has no tab open in the focused window. Ask the user to open it.",
    };
  // Focus ONLY when the user is already looking at this project. A background
  // agent must not pull the screen away from whatever is being worked on.
  return { ok: true, tabId: own.id, focus: own.id === focusedTabId };
}
