import { useState } from "react";
import { ChangelogView } from "./ChangelogView";
import { OverviewView } from "./OverviewView";

type OverviewNav = "overview" | "changelog";

// The Overview page shell: a small page-local nav (Overview | Changelog) over the
// project's OverviewView (detected stack + prose) and its ChangelogView (the
// append-only journal the add_changelog_entry MCP tool writes).
export function OverviewTab({ root }: { root: string }) {
  const [view, setView] = useState<OverviewNav>("overview");
  return (
    <div className="overview-page">
      <nav className="overview-nav">
        {(["overview", "changelog"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`overview-nav-item${view === v ? " active" : ""}`}
            onClick={() => setView(v)}
          >
            {v === "overview" ? "Overview" : "Changelog"}
          </button>
        ))}
      </nav>
      <div className="overview-page-body">
        {view === "overview" ? (
          <OverviewView root={root} />
        ) : (
          <ChangelogView root={root} />
        )}
      </div>
    </div>
  );
}
