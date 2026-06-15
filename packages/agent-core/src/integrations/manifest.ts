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

// Where a manifest's items render. Absent or "activity" = the transient
// Activity feed (default). { view } = a steady-state surface rendered under
// that sidebar view (e.g. "databases").
export type Surface = "activity" | { view: string };

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
  surface?: Surface; // default "activity" (transient, Activity feed)
  // How to install the CLI when it is absent. Surfaced as an "Install" button on
  // the absent row; clicking RUNS `command` in a new terminal (nothing auto-runs
  // -- the user chooses). `docsUrl` is an optional manual-install fallback.
  install?: { command: string; docsUrl?: string };
  // How to authenticate the CLI when it is installed but not connected. The
  // unauthed row's "Connect" button RUNS this in a new terminal -- user-initiated,
  // never background. (Terminal-interactive auth is fine here; only BACKGROUND
  // polling that opens a browser is unsafe -- see the Neon note in registry.ts.)
  connect?: { command: string; docsUrl?: string };
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
