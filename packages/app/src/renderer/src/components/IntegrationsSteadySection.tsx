import { useEffect, useState } from "react";
import type { IntegrationItem, SteadyIntegration } from "../../../shared/ipc";

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

  const shown = items.filter((s) => s.status !== "absent");
  if (shown.length === 0) return null;

  return (
    <>
      {shown.map((s) => (
        <div key={s.id} className="db-block">
          <div className="db-subhead">{s.name}</div>
          {s.status === "unauthed" ? (
            <div className="section-note">{s.name} — not connected</div>
          ) : (
            s.resources.map((r) => (
              <div key={r.id} className="db-row">
                <span className={dotClass(r.state)} />
                <span className="db-name">{r.title}</span>
                {r.subtitle && <span className="db-sub">{r.subtitle}</span>}
              </div>
            ))
          )}
        </div>
      ))}
    </>
  );
}
