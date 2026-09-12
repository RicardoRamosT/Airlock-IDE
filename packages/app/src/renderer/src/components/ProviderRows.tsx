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
//
// HOW rule 1 is satisfied changed: the reason used to be a SENTENCE in the row
// ("not connected", "3 database containers", "5 warehouses"), which is how a
// 230px sidebar filled up with prose that then had to survive being resized.
// The reason is now carried by a state DOT plus a bare COUNT, with the sentence
// moved to the row's tooltip and to screen-reader text. The row still always
// states a reason -- it just stops narrating it. Nothing in a quiet row can
// wrap, because there is no prose left in it to wrap.
export type ProviderTone =
  // connected, and working
  | "ok"
  // installed but not usable -- e.g. Docker present with the daemon down
  | "warn"
  // not connected, not signed in, CLI absent, or not used in this project
  | "off"
  // the probe has not answered yet. NOT the same as "off": a CLI probe can
  // take seconds, and painting a finished-looking "not connected" while it
  // runs is the three-states mistake Loading.tsx exists to prevent.
  | "unknown";

export interface ProviderInstance {
  key: string;
  label: string;
  // Secondary text (an image tag, a deploy status). Carried in the tooltip
  // rather than the row -- it is the detail you go looking for, not the thing
  // you scan the list for.
  detail?: string;
  action?: { label: string; onClick: () => void };
}

export interface ProviderRow {
  id: string;
  name: string;
  icon: string;
  // Always non-empty -- see rule 1. Now the tooltip + screen-reader text.
  state: string;
  tone: ProviderTone;
  // Rendered bare ("3", not "3 database containers"). Omitted where a count
  // would be meaningless, in which case the row carries an ACTION instead --
  // an unconnected provider offers "Connect", it does not describe its own
  // absence.
  count?: number;
  connect?: { label: string; onClick: () => void };
  instances: ProviderInstance[];
}

// Tone -> the rail's existing status-dot vocabulary, reused verbatim rather
// than invented here: green = connected, yellow = available but off, grey =
// not connected. `unknown` renders NO dot on purpose -- a probe can take
// seconds, and a grey dot during it asserts "not connected" before anything
// knows that.
const DOT: Record<ProviderTone, string | null> = {
  ok: "green",
  warn: "yellow",
  off: "grey",
  unknown: null,
};

export function ProviderRows({ rows }: { rows: ProviderRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="provider-rows">
      {rows.map((r) => (
        <div key={r.id} className="provider">
          <div className="provider-head" title={r.state}>
            {/* The product glyph stays: it is what you actually scan a list of
                five providers for. The status rides its corner, the same way
                the rail already badges an extension icon. */}
            <span className="activity-icon-glyph provider-glyph">
              <SectionGlyph icon={r.icon} />
              {DOT[r.tone] && (
                <span className={`activity-dot ${DOT[r.tone]}`} />
              )}
            </span>
            <span className="provider-name">{r.name}</span>
            {/* The sentence the dot replaced. Sighted users hover; screen
                readers get it inline, so going quiet costs them nothing. */}
            <span className="sr-only">{r.state}</span>
            {typeof r.count === "number" && (
              <span className="provider-count">{r.count}</span>
            )}
            {r.connect && (
              <button
                type="button"
                className="btn provider-connect"
                onClick={r.connect.onClick}
              >
                {r.connect.label}
              </button>
            )}
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
          {r.instances.map((i) => (
            <div
              key={i.key}
              className="provider-instance"
              title={i.detail ? `${i.label} — ${i.detail}` : i.label}
            >
              <span className="provider-instance-label">{i.label}</span>
              {i.detail && <span className="sr-only">{i.detail}</span>}
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
