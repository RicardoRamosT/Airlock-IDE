import { useApp } from "../store";
import { LayoutControls } from "./LayoutControls";

const basename = (root: string | null): string =>
  root ? (root.split("/").pop() ?? "") : "";

export function TitleBar() {
  const activeTabId = useApp((s) => s.activeTabId);
  const split = useApp((s) => s.split);
  const tabState = useApp((s) => s.tabState);
  // While the split is ON SCREEN (focused tab is a pair member) the title
  // names BOTH projects in pane order; otherwise just the focused project.
  const showSplit =
    split !== null && (activeTabId === split.a || activeTabId === split.b);
  const names = (
    showSplit && split
      ? [
          basename(tabState[split.a]?.root ?? null),
          basename(tabState[split.b]?.root ?? null),
        ]
      : [basename(tabState[activeTabId]?.root ?? null)]
  ).filter(Boolean);
  const project = names.join(" + ");
  return (
    <header className="titlebar">
      <span className="titlebar-title">
        {project ? `AirLock - ${project}` : "AirLock"}
      </span>
      <LayoutControls />
    </header>
  );
}
