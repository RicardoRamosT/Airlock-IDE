import { useEffect, useState } from "react";
import type { SteadyIntegration } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { ResourceRow } from "./ResourceRow";

// Renders manifest-driven STEADY-STATE integrations for one sidebar view (e.g.
// "databases"). Account-wide, so it polls integrations:steady on a timer; the
// main-process engine caches each manifest to its everyMs cadence. Empty-states:
// absent -> nothing; unauthed -> a faint "not connected" hint; ready -> a header
// plus one row per resource.
export function IntegrationsSteadySection({ view }: { view: string }) {
  const [items, setItems] = useState<SteadyIntegration[]>([]);
  const hostRefreshNonce = useApp((s) => s.hostRefreshNonce);
  // Relevance + resources are scoped to the focused project main-side, so reload
  // (and drop the old project's rows first) when it changes.
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: root is the trigger; reset rows on project switch so the previous project's never linger.
  useEffect(() => {
    setItems([]);
  }, [root]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: hostRefreshNonce and root are not read in the body but are intentional trigger deps — refetch on the HOST-header Refresh and on project switch (and re-arm the poll).
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void window.airlock
        .integrationsSteady()
        .then((all) => {
          if (!cancelled) setItems(all.filter((s) => s.view === view));
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [view, hostRefreshNonce, root]);

  // Absent/unauthed integrations are shown (rather than hidden) as a .sb-card
  // with an explainer + a full-width primary CTA -- matching the carded
  // "Connect Neon"/"Connect Render" states -- so a missing or unconnected CLI
  // reads as actionable, not broken. The button RUNS the install/connect
  // command in a new terminal (user-initiated; nothing background-runs).
  if (items.length === 0) return null;

  return (
    <div className="databases">
      {items.map((s) => {
        if (s.status === "absent") {
          return (
            <div key={s.id} className="sb-card">
              <span className="section-note">
                {s.name} CLI isn't installed.
              </span>
              <button
                type="button"
                className="btn primary"
                title={s.install?.command}
                onClick={() => {
                  const c = s.install?.command;
                  if (c) useApp.getState().runInNewTerminal(c);
                }}
              >
                Install {s.name} CLI
              </button>
            </div>
          );
        }
        if (s.status === "unauthed") {
          return (
            <div key={s.id} className="sb-card">
              <span className="section-note">
                Sign in to {s.name} to see its resources.
              </span>
              <button
                type="button"
                className="btn primary"
                title={s.connect?.command}
                onClick={() => {
                  const c = s.connect?.command;
                  if (c) useApp.getState().runInNewTerminal(c);
                }}
              >
                Connect {s.name}
              </button>
            </div>
          );
        }
        return (
          <div key={s.id} className="db-entry">
            <div className="db-row">
              <span className="db-name">{s.name}</span>
            </div>
            <div className="neon-children">
              {s.resources.length === 0 ? (
                <div className="section-note">no resources</div>
              ) : (
                s.resources.map((r) => <ResourceRow key={r.id} r={r} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
