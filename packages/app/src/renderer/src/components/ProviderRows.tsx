import type { Section } from "../../../shared/ipc";
import { extSectionId } from "../lib/sections";
import { useApp } from "../store";
import { SectionGlyph } from "./SectionGlyph";

// The "from your extensions" block, shared verbatim by Databases and Host.
//
// Three rules make this work, and all three are the point:
//
// 1. THE PROVIDER ROW IS ALWAYS PRESENT. Not conditional on being connected.
//    Its job is to always say something true -- "not installed", "not running",
//    "no database containers", "3 branches". This is the fix for the
//    "Nothing to show yet." class of empty state, which is a correct answer
//    that never says WHY.
// 2. TWO LEVELS OF CONNECT, NEVER CONFLATED. Connecting the EXTENSION (is
//    Docker running, am I signed into Neon) is a different act from connecting
//    an INSTANCE (open a Postgres session). The provider row carries the first,
//    an instance row the second.
// 3. EVERY ROW LINKS TO ITS EXTENSION. Neither section shows a full inventory:
//    Databases shows what you can query, Host shows what is running, and
//    everything else lives one click away in the extension's own area.
export interface ProviderInstance {
  key: string;
  label: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}

export interface ProviderRow {
  id: string;
  name: string;
  icon: string;
  // Always non-empty -- see rule 1.
  state: string;
  connect?: { label: string; onClick: () => void };
  instances: ProviderInstance[];
}

export function ProviderRows({ rows }: { rows: ProviderRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="provider-rows">
      <div className="sb-section-head">
        <span>From your extensions</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="provider">
          <div className="provider-head">
            <SectionGlyph icon={r.icon} />
            <span className="provider-name">{r.name}</span>
            <span className="provider-state">{r.state}</span>
            <button
              type="button"
              className="row-action"
              aria-label={`Open ${r.name}`}
              title={`Open ${r.name}`}
              onClick={() =>
                useApp.getState().setActiveView(extSectionId(r.id) as Section)
              }
            >
              <i className="codicon codicon-arrow-right" />
            </button>
          </div>
          {r.connect && (
            <button
              type="button"
              className="btn primary provider-connect"
              onClick={r.connect.onClick}
            >
              {r.connect.label}
            </button>
          )}
          {r.instances.map((i) => (
            <div key={i.key} className="provider-instance">
              <span className="provider-instance-label">{i.label}</span>
              {i.detail && (
                <span className="provider-instance-detail">{i.detail}</span>
              )}
              {i.action && (
                <button
                  type="button"
                  className="btn"
                  onClick={i.action.onClick}
                >
                  {i.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
