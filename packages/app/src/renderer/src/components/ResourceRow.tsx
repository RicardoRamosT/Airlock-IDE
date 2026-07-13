import { useState } from "react";
import type { IntegrationItem, ItemAction } from "../../../shared/ipc";
import { useApp } from "../store";

// Shared by the sidebar sections that surface integration resources
// (IntegrationsSteadySection, and the Git/Activity extension-resource rows).
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
export function ResourceRow({ r }: { r: IntegrationItem }) {
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
