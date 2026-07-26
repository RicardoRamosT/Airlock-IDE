import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { TitleQuota } from "./TitleQuota";

// Title-case the folder name so the titlebar matches the project tabs.
const titleCase = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
const basename = (root: string | null): string =>
  root ? titleCase(root.split("/").pop() ?? "") : "";

export function TitleBar() {
  const activeTabId = useApp((s) => s.activeTabId);
  const split = useApp((s) => s.split);
  const tabState = useApp((s) => s.tabState);
  const openProjectsAsTabs = useApp((s) => s.openProjectsAsTabs);
  const tabsLen = useApp((s) => s.tabs.length);
  const settingsTabOpen = useApp((s) => s.settingsTabOpen);
  const usageTabOpen = useApp((s) => s.usageTabOpen);
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
  // The project strip hides entirely in separate-windows mode with a single
  // project + no IDE page-tab (ProjectTabs returns null there), so the "!" has
  // no tab to live on — surface it in the always-present TitleBar instead.
  const stripHidden =
    !openProjectsAsTabs && tabsLen <= 1 && !settingsTabOpen && !usageTabOpen;
  const activeRoot = tabState[activeTabId]?.root ?? null;
  const openOverview = (): void => {
    if (!activeRoot) return;
    // Overview is focus-bound: show the active project's Overview in the main
    // area (the focused project tab also carries an inline Overview entry).
    useApp.getState().showOverview(activeRoot);
  };
  const title = project ? `AirLock - ${project}` : "AirLock";
  // Animate the title card's width to fit the name: measure the inner text and
  // set the card width (a transition on width then eases between names). Remeasure
  // on name change + once fonts are ready (metrics settle a frame after mount).
  const textRef = useRef<HTMLSpanElement>(null);
  const [titleW, setTitleW] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const w = textRef.current?.offsetWidth;
    if (w) setTitleW(w);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: remeasure when the title text changes.
  useLayoutEffect(() => {
    const w = textRef.current?.offsetWidth;
    if (w) setTitleW(w);
  }, [title]);
  useEffect(() => {
    void document.fonts?.ready.then(() => {
      const w = textRef.current?.offsetWidth;
      if (w) setTitleW(w);
    });
  }, []);
  return (
    <header className="titlebar">
      {/* The title card, flanked by the Claude usage wings (5h left, 7d right).
          TitleQuota owns the centering group so the card stays centered whether
          or not the meter is enabled; the card itself stays non-interactive. */}
      <TitleQuota>
        <span
          className="titlebar-title"
          style={titleW ? { width: `${titleW}px` } : undefined}
        >
          <span className="titlebar-title-text" ref={textRef}>
            {title}
          </span>
        </span>
      </TitleQuota>
      {stripHidden && activeRoot && (
        <button
          type="button"
          className="titlebar-overview"
          title="Project overview"
          onClick={openOverview}
        >
          <i className="codicon codicon-book" />
        </button>
      )}
    </header>
  );
}
