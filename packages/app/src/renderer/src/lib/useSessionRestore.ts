import { useEffect, useRef } from "react";
import { CLAUDE_CONTINUE_COMMAND, useApp } from "../store";
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

      // Reopen: reuse the boot blank tab for the first project, then openProject.
      const rootToTab = new Map<string, string>();
      plan.roots.forEach((root, i) => {
        if (i === 0) s.fillActiveTab(root);
        else s.openProject(root);
        // openProject/fillActiveTab set activeTabId to the new tab.
        rootToTab.set(root, useApp.getState().activeTabId);
      });
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

  // (2) Focus-gated resume: when the active tab is pending and has a live
  // terminal, inject claude --continue once. Re-runs as tabTerminals updates
  // (so it retries after the pty adopts).
  const activeTabId = useApp((s) => s.activeTabId);
  // tabTerminals is an intentional change-trigger (not read in the body, which
  // snapshots fresh state via useApp.getState()): it re-fires this effect as a
  // pty adopts so the resume retries until sendToClaudeTerminal succeeds.
  const tabTerminals = useApp((s) => s.tabTerminals);
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger deps, not used in the body
  useEffect(() => {
    const s = useApp.getState();
    if (!s.pendingResume.has(activeTabId)) return;
    // sendToClaudeTerminal returns false if no pty has adopted yet -> keep the
    // marker and retry on the next tabTerminals change.
    if (s.sendToClaudeTerminal(CLAUDE_CONTINUE_COMMAND, activeTabId)) {
      s.consumePendingResume(activeTabId);
    }
  }, [activeTabId, tabTerminals]);
}
