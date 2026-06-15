import { useEffect, useState } from "react";
import type { IntegrationItem, SteadyIntegration } from "../../../shared/ipc";
import { useApp } from "../store";

// Per the per-section convention, each section owns its dot mapping.
function dotClass(state: IntegrationItem["state"]): string {
  if (state === "done") return "status-dot on";
  if (state === "failed") return "status-dot fail";
  if (state === "running") return "status-dot running";
  return "status-dot";
}

// Renders manifest-driven STEADY-STATE integrations for one sidebar view (e.g.
// "databases"). Account-wide, so it polls integrations:steady on a timer; the
// main-process engine caches each manifest to its everyMs cadence. Empty-states:
// absent -> nothing; unauthed -> a faint "not connected" hint; ready -> a header
// plus one row per resource.
export function IntegrationsSteadySection({ view }: { view: string }) {
  const [items, setItems] = useState<SteadyIntegration[]>([]);

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
  }, [view]);

  // Absent integrations are shown (with an Install affordance) rather than
  // hidden, so a missing CLI reads as "installable", not "broken".
  if (items.length === 0) return null;

  return (
    <div className="databases">
      {items.map((s) => {
        if (s.status === "absent") {
          return (
            <div key={s.id} className="db-entry">
              <div className="db-row">
                <span className="section-note">{s.name} CLI not installed</span>
                {s.install && (
                  <button
                    type="button"
                    className="btn"
                    title={s.install.command}
                    onClick={() => {
                      const c = s.install?.command;
                      if (c) useApp.getState().runInNewTerminal(c);
                    }}
                  >
                    Install
                  </button>
                )}
              </div>
            </div>
          );
        }
        if (s.status === "unauthed") {
          return (
            <div key={s.id} className="db-entry">
              <div className="section-note">{s.name} — not connected</div>
            </div>
          );
        }
        return (
          <div key={s.id} className="db-entry">
            <div className="db-row">
              <span className="db-name">{s.name}</span>
            </div>
            <div className="neon-children">
              {s.resources.map((r) => (
                <div key={r.id} className="db-row">
                  <span className={dotClass(r.state)} />
                  <span className="db-name">{r.title}</span>
                  {r.subtitle && <span className="db-host">{r.subtitle}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
