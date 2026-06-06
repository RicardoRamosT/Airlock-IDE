import { createContext, useContext } from "react";
import { useApp } from "../store";

// The tab a per-project panel belongs to. null/no-provider => the focused
// (active) tab, so single-pane chrome reads the active project unchanged. The
// split layout (a later task) wraps each pane's subtree in a provider with that
// pane's tabId so the same panels render two different projects side by side.
export const ProjectPaneContext = createContext<string | null>(null);

// The tabId of the pane this component renders in. Without a provider it falls
// back to the active (focused) tab, which is exactly the tab whose ProjectState
// is mirrored to the top level -- so single-pane behavior is identical.
export function useProjectTab(): string {
  const ctx = useContext(ProjectPaneContext);
  const activeTabId = useApp((s) => s.activeTabId);
  return ctx ?? activeTabId;
}
