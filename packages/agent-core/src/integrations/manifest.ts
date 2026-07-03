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

// One labeled detail line shown when a resource row is expanded. `value` is an
// expr into the item (e.g. "$.location").
export interface DetailSpec {
  label: string;
  value: string;
}

// A per-resource action button. `template` is resolved per item at map time by
// substituting {{$.path}} placeholders (see resolveAction in map.ts):
//   - kind "url": the resolved string is opened externally; it MUST be http(s)
//     (the renderer validates before opening).
//   - kind "command": the resolved string is RUN in a new terminal on click.
//     Every substituted value is single-quote-escaped, since it comes from the
//     polled CLI's JSON -- a resource name can never break out of the command.
// `when` limits the button to those item states (e.g. Stop only when running);
// omit to always show.
export interface ActionSpec {
  label: string;
  icon: string; // codicon name
  kind: "command" | "url";
  template: string;
  when?: IntegrationState[];
}

export interface MapSpec {
  items?: string; // expr selecting an array; omit => the whole doc is one item
  key?: string; // per-item stable id expr; default = the title's value
  title: string;
  subtitle?: string;
  href?: string;
  state: StateSpec;
  show?: IntegrationState[]; // surface only these; default ["running","failed"]
  details?: DetailSpec[];
  actions?: ActionSpec[];
}

// Where a manifest's items render. Absent or "activity" = the transient
// Activity feed (default). { view } = a steady-state surface rendered under
// that sidebar view (e.g. "databases").
export type Surface = "activity" | { view: string };

// Gates a steady integration to projects that actually USE it. Account-wide
// CLIs (`az webapp list`, `snow ... SHOW WAREHOUSES`) return the whole
// subscription, so without this they surface in every project. A project is
// relevant iff a vaulted secret NAME starts with `envPrefix`, or the project
// root contains one of `files`. No relevance spec => always shown (a genuinely
// account-global integration). See isRelevant in engine.ts.
export interface RelevanceSpec {
  envPrefix?: string;
  files?: string[];
}

export interface IntegrationManifest {
  id: string; // stable; item ids are `int:<id>:<key>`
  name: string;
  icon?: string; // codicon name for the Extension Hub row (optional; UI falls back)
  detect: { authCheck: Command }; // ready iff this command exits 0
  poll: {
    everyMs: number;
    timeoutMs?: number; // default 8000
    cwdScoped?: boolean; // run in the focused project root
    cli: Command; // stdout parsed as JSON
  };
  map: MapSpec;
  surface?: Surface; // default "activity" (transient, Activity feed)
  // Steady integrations only: limit the surface to projects that use the tool.
  relevance?: RelevanceSpec;
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

// A resolved detail line on an item (the DetailSpec after expr evaluation).
export interface ItemDetail {
  label: string;
  value: string;
}

// A resolved action on an item: `target` is the fully-substituted command line
// (kind "command") or url (kind "url"). `when` is carried through so the
// renderer can show it only in the matching item states.
export interface ItemAction {
  label: string;
  icon: string;
  kind: "command" | "url";
  target: string;
  when?: IntegrationState[];
}

// Neutral, UI-agnostic result. app/main maps this to the renderer's
// ActivityItem (see activity.ts), keeping agent-core free of UI types.
export interface IntegrationItem {
  id: string;
  title: string;
  subtitle: string;
  state: IntegrationState;
  href?: string;
  details?: ItemDetail[];
  actions?: ItemAction[];
}
