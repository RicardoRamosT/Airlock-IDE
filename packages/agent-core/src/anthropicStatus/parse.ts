// Pure mapping of the Anthropic Statuspage payload onto a friendly indicator.
//
// It reads COMPONENTS, not the page-wide rollup. The rollup is the worst of
// every Anthropic product, so on 2026-09-14 it said "Partially Degraded
// Service" -- and the AirLock status pill said "Claude Degraded" for days --
// because Claude Cowork was degraded ON WINDOWS. Claude Code and the API were
// both operational the whole time. A status light that reports products you do
// not use, on a platform you are not on, is noise wearing the costume of
// signal.
//
// Source shape (status.claude.com/api/v2/summary.json):
//   { status:     { indicator: "none"|"minor"|"major"|"critical"|"maintenance",
//                   description: string },
//     components: [ { name: string, status: "operational"|... } ] }
export type AnthropicIndicator =
  | "operational"
  | "degraded"
  | "outage"
  | "maintenance"
  | "unknown";

export interface ParsedAnthropicStatus {
  indicator: AnthropicIndicator;
  description: string;
  // WHICH component decided this, so the pill can name it instead of saying
  // "Claude" and leaving the user to guess. null when the judgement came from
  // the page-wide rollup.
  component: string | null;
}

// The only components AirLock's work depends on: the CLI, and the API it talks
// to. Matched by PREFIX because Statuspage carries the hostname in the label
// ("Claude API (api.anthropic.com)"), which is exactly the sort of thing that
// gets reworded.
const WATCHED = ["Claude Code", "Claude API"];

const INDICATOR_MAP: Record<string, AnthropicIndicator> = {
  none: "operational",
  minor: "degraded",
  major: "outage",
  critical: "outage",
  maintenance: "maintenance",
};

// Statuspage component states. partial_outage stays SHORT of "outage" so that
// "outage" keeps meaning "it is down" and stays actionable.
const COMPONENT_MAP: Record<string, AnthropicIndicator> = {
  operational: "operational",
  degraded_performance: "degraded",
  partial_outage: "degraded",
  major_outage: "outage",
  under_maintenance: "maintenance",
};

// Worst-first, so the reduce below is a simple index comparison.
const SEVERITY: AnthropicIndicator[] = [
  "outage",
  "degraded",
  "maintenance",
  "unknown",
  "operational",
];
const worseOf = (a: AnthropicIndicator, b: AnthropicIndicator) =>
  SEVERITY.indexOf(a) <= SEVERITY.indexOf(b) ? a : b;

function readable(componentStatus: string): string {
  return componentStatus.replace(/_/g, " ");
}

export function parseAnthropicStatus(json: unknown): ParsedAnthropicStatus {
  if (!json || typeof json !== "object")
    return { indicator: "unknown", description: "", component: null };
  const root = json as Record<string, unknown>;

  // Components first. Only fall through when there are none we recognise --
  // a rename upstream must degrade to the old behaviour, not to nothing.
  const components = Array.isArray(root.components) ? root.components : [];
  let worst: AnthropicIndicator | null = null;
  let worstName: string | null = null;
  let worstRaw = "";
  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name : "";
    const state = typeof c.status === "string" ? c.status : "";
    if (!WATCHED.some((w) => name.startsWith(w))) continue;
    const mapped = COMPONENT_MAP[state] ?? "unknown";
    if (worst === null || worseOf(mapped, worst) === mapped) {
      // Keep the FIRST of equal severity: watched order is our priority order.
      if (
        worst === null ||
        SEVERITY.indexOf(mapped) < SEVERITY.indexOf(worst)
      ) {
        worst = mapped;
        worstName = name;
        worstRaw = state;
      }
    }
  }
  if (worst !== null)
    return {
      indicator: worst,
      description:
        worst === "operational"
          ? "Claude Code and the API are operational"
          : `${worstName}: ${readable(worstRaw)}`,
      component: worstName,
    };

  const status = root.status;
  if (!status || typeof status !== "object")
    return { indicator: "unknown", description: "", component: null };
  const s = status as Record<string, unknown>;
  const ind = typeof s.indicator === "string" ? s.indicator : "";
  const description = typeof s.description === "string" ? s.description : "";
  return {
    indicator: INDICATOR_MAP[ind] ?? "unknown",
    description,
    component: null,
  };
}
