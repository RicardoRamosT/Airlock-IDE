// Pure mapping of the Anthropic Statuspage summary onto a friendly indicator.
// Source shape (status.anthropic.com/api/v2/status.json):
//   { status: { indicator: "none"|"minor"|"major"|"critical"|"maintenance",
//               description: string } }
export type AnthropicIndicator =
  | "operational"
  | "degraded"
  | "outage"
  | "maintenance"
  | "unknown";

export interface ParsedAnthropicStatus {
  indicator: AnthropicIndicator;
  description: string;
}

const INDICATOR_MAP: Record<string, AnthropicIndicator> = {
  none: "operational",
  minor: "degraded",
  major: "outage",
  critical: "outage",
  maintenance: "maintenance",
};

export function parseAnthropicStatus(json: unknown): ParsedAnthropicStatus {
  if (!json || typeof json !== "object")
    return { indicator: "unknown", description: "" };
  const status = (json as Record<string, unknown>).status;
  if (!status || typeof status !== "object")
    return { indicator: "unknown", description: "" };
  const s = status as Record<string, unknown>;
  const ind = typeof s.indicator === "string" ? s.indicator : "";
  const description = typeof s.description === "string" ? s.description : "";
  return { indicator: INDICATOR_MAP[ind] ?? "unknown", description };
}
