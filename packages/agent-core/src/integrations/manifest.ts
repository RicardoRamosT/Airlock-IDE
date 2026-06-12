// packages/agent-core/src/integrations/manifest.ts
// One integration described as DATA, not code. engine.ts runs it; map.ts turns
// its output into IntegrationItems. v1: CLI probes feeding the Activity feed.
// HTTP probes and customParser escape hatches arrive in Plan 2.
export interface Command {
  cmd: string;
  args: string[];
}

export type IntegrationState = "running" | "done" | "failed" | "idle";

export interface StateSpec {
  from: string; // expr into one item, e.g. "$.readyState"
  running?: string[];
  done?: string[];
  failed?: string[];
  default?: IntegrationState; // when no list matches; default "idle"
}

export interface MapSpec {
  items?: string; // expr selecting an array; omit => the whole doc is one item
  key?: string; // per-item stable id expr; default = the title's value
  title: string;
  subtitle?: string;
  href?: string;
  state: StateSpec;
  show?: IntegrationState[]; // surface only these; default ["running","failed"]
}

export interface IntegrationManifest {
  id: string; // stable; item ids are `int:<id>:<key>`
  name: string;
  detect: { authCheck: Command }; // ready iff this command exits 0
  poll: {
    everyMs: number;
    timeoutMs?: number; // default 8000
    cwdScoped?: boolean; // run in the focused project root
    cli: Command; // stdout parsed as JSON
  };
  map: MapSpec;
}

// Neutral, UI-agnostic result. app/main maps this to the renderer's
// ActivityItem (see activity.ts), keeping agent-core free of UI types.
export interface IntegrationItem {
  id: string;
  title: string;
  subtitle: string;
  state: IntegrationState;
  href?: string;
}
