import { useEffect, useRef } from "react";
import { CLAUDE_AUTO_COMMAND, CLAUDE_CONTINUE_COMMAND, useApp } from "../store";
import { planRestore } from "./sessionRestore";

// On startup: read the snapshot and (if enabled) reopen the projects, restore
// the split + active tab, and mark Claude tabs for lazy resume. Runs exactly
// once. Existence of a root is checked via window.airlock.dirExists(root) (a
// directory stat -- fs:exists rejects directories, so it cannot vet a root).
// A second effect injects claude --continue when a marked tab is focused AND its
// terminal has a live pty (sendToClaudeTerminal returns false until then).
export function useSessionRestore(): void {
  const layoutHydrated = useApp((s) => s.layoutHydrated);
  const started = useRef(false);

  // (1) One-shot restore after prefs hydrate.
  useEffect(() => {
    if (!layoutHydrated || started.current) return;
    started.current = true;
    void (async () => {
      const s = useApp.getState();
      if (!s.restoreSession) {
        s.setSessionRestoreDone(true);
        return;
      }
      const snap = await window.airlock.sessionGet();
      if (!snap || snap.tabs.length === 0) {
        s.setSessionRestoreDone(true);
        return;
      }
      // Existence check per root (parallel). dirExists stats the root and
      // returns true only for an existing directory.
      const exists = await Promise.all(
        snap.tabs.map((t) =>
          window.airlock.dirExists(t.root).catch(() => false),
        ),
      );
      const existsSet = new Set(
        snap.tabs.filter((_, i) => exists[i]).map((t) => t.root),
      );
      const plan = planRestore(snap, (r) => existsSet.has(r));
      if (plan.roots.length === 0) {
        s.setSessionRestoreDone(true);
        return; // every saved folder is gone -> keep the default blank tab
      }

      // Open EVERY project as a fresh tab so its terminal spawns in the project
      // root. (Reusing the boot blank tab via fillActiveTab kept that tab's
      // already-spawned $HOME shell -> wrong cwd, and claude --continue then
      // resumed the wrong directory.) The leftover boot blank tab is dropped
      // afterward so its $HOME terminal does not linger.
      const blankTabId = useApp.getState().activeTabId;
      const rootToTab = new Map<string, string>();
      for (const root of plan.roots) {
        s.openProject(root); // sets activeTabId to the new tab
        rootToTab.set(root, useApp.getState().activeTabId);
      }
      if (useApp.getState().tabState[blankTabId]?.root == null) {
        s.closeTab(blankTabId);
      }
      // Strip order follows the restored order.
      s.setStripOrder(plan.roots.map((r) => rootToTab.get(r) as string));
      // Split (both members exist per the plan).
      if (plan.split) {
        const a = rootToTab.get(plan.split.a) as string;
        const b = rootToTab.get(plan.split.b) as string;
        s.switchTab(a);
        s.splitActiveWith(b);
      }
      // Mark resume tabs BEFORE their terminals adopt, so claudeAutoDecision
      // suppresses fresh auto-start.
      s.markPendingResume(
        plan.resumeRoots.map((r) => rootToTab.get(r) as string),
      );
      // Focus the active tab last (fires the resume effect for it).
      if (plan.activeRoot)
        s.switchTab(rootToTab.get(plan.activeRoot) as string);
      s.setSessionRestoreDone(true);
    })();
  }, [layoutHydrated]);

  const activeTabId = useApp((s) => s.activeTabId);
  const tabTerminals = useApp((s) => s.tabTerminals);
  const pendingResume = useApp((s) => s.pendingResume);
  // Per-tab resolved resume command (continue vs fresh), and an in-flight guard so
  // the async session check runs at most once per tab while the effect re-fires on
  // tabTerminals/pendingResume changes (retrying until the pty adopts).
  const resumeCmd = useRef<Map<string, string>>(new Map());
  const resolving = useRef<Set<string>>(new Set());
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger deps, not used in the body
  useEffect(() => {
    const s = useApp.getState();
    if (!s.pendingResume.has(activeTabId)) return;
    const inject = (cmd: string) => {
      // sendToClaudeTerminal returns false until a pty adopts -> keep the marker
      // and retry on the next tabTerminals change.
      if (useApp.getState().sendToClaudeTerminal(cmd, activeTabId)) {
        useApp.getState().consumePendingResume(activeTabId);
        useApp.getState().adoptResumedClaude(activeTabId);
      }
    };
    const cached = resumeCmd.current.get(activeTabId);
    if (cached !== undefined) {
      inject(cached);
      return;
    }
    if (resolving.current.has(activeTabId)) return;
    resolving.current.add(activeTabId);
    const root = s.tabState[activeTabId]?.root ?? null;
    const decide = root
      ? window.airlock.hasResumableSession(root).catch(() => false)
      : Promise.resolve(false);
    void decide.then((has) => {
      const cmd = has ? CLAUDE_CONTINUE_COMMAND : CLAUDE_AUTO_COMMAND;
      resumeCmd.current.set(activeTabId, cmd);
      resolving.current.delete(activeTabId);
      // If the pty is already live, inject now; otherwise the next tabTerminals
      // tick re-fires this effect and injects the cached command.
      if (useApp.getState().pendingResume.has(activeTabId)) inject(cmd);
    });
  }, [activeTabId, tabTerminals, pendingResume]);
}
