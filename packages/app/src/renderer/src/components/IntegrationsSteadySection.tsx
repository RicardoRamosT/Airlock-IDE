import { useEffect, useState } from "react";
import type {
  IntegrationItem,
  ItemAction,
  SteadyIntegration,
} from "../../../shared/ipc";
import { useApp } from "../store";

// Per the per-section convention, each section owns its dot mapping.
function dotClass(state: IntegrationItem["state"]): string {
  if (state === "done") return "status-dot on";
  if (state === "failed") return "status-dot fail";
  if (state === "running") return "status-dot running";
  return "status-dot";
}

// One resource row. Static when the manifest gave it no details/actions (e.g.
// Snowflake warehouses); otherwise a click-to-expand row over a details +
// actions body. Actions are filtered by `when` against the row's state, so a
// running app shows Stop and a stopped one shows Start. URL actions open
// externally (http(s)-validated main-side); command actions run in a new
// terminal -- the same user-initiated path as the Install/Connect buttons.
function ResourceRow({ r }: { r: IntegrationItem }) {
  const [open, setOpen] = useState(false);
  const details = r.details ?? [];
  const actions = (r.actions ?? []).filter(
    (a) => !a.when || a.when.includes(r.state),
  );
  const expandable = details.length > 0 || actions.length > 0;

  const runAction = (a: ItemAction) => {
    if (a.kind === "url") void window.airlock.hostOpenExternal(a.target);
    else useApp.getState().runInNewTerminal(a.target);
  };

  if (!expandable) {
    return (
      <div className="db-row">
        <span className={dotClass(r.state)} />
        <span className="db-name">{r.title}</span>
        {r.subtitle && <span className="db-host">{r.subtitle}</span>}
      </div>
    );
  }

  return (
    <div className="int-resource">
      <button
        type="button"
        className="db-row"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
        <span className={dotClass(r.state)} />
        <span className="db-name">{r.title}</span>
        {r.subtitle && <span className="db-host">{r.subtitle}</span>}
      </button>
      {open && (
        <div className="int-body">
          {details.map((d) => (
            <div key={d.label} className="int-detail">
              <span className="int-detail-label">{d.label}</span>
              <span className="int-detail-value">{d.value}</span>
            </div>
          ))}
          {actions.length > 0 && (
            <div className="section-toolbar">
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="btn"
                  title={a.target}
                  onClick={() => runAction(a)}
                >
                  <i className={`codicon codicon-${a.icon}`} />
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Renders manifest-driven STEADY-STATE integrations for one sidebar view (e.g.
// "databases"). Account-wide, so it polls integrations:steady on a timer; the
// main-process engine caches each manifest to its everyMs cadence. Empty-states:
// absent -> nothing; unauthed -> a faint "not connected" hint; ready -> a header
// plus one row per resource.
export function IntegrationsSteadySection({ view }: { view: string }) {
  const [items, setItems] = useState<SteadyIntegration[]>([]);
  const hostRefreshNonce = useApp((s) => s.hostRefreshNonce);

  // biome-ignore lint/correctness/useExhaustiveDependencies: hostRefreshNonce is not read in the body but intentionally included as a trigger dep — the single HOST-header Refresh bumps it to reload immediately (and re-arm the poll).
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
  }, [view, hostRefreshNonce]);

  // Absent/unauthed integrations are shown (rather than hidden) as a full-width
  // action button -- matching the "Connect Neon"/"Connect Render" buttons -- so a
  // missing or unconnected CLI reads as actionable, not broken. A `.btn` stretches
  // to full width as a flex child of `.databases`. The button RUNS the install/
  // connect command in a new terminal (user-initiated; nothing background-runs).
  if (items.length === 0) return null;

  return (
    <div className="databases">
      {items.map((s) => {
        if (s.status === "absent") {
          return (
            <div key={s.id} className="section-toolbar">
              <button
                type="button"
                className="btn"
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
            <div key={s.id} className="section-toolbar">
              <button
                type="button"
                className="btn"
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
