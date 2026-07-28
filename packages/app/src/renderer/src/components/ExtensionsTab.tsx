import { useEffect, useState } from "react";
import type { ExtensionAction, ExtensionSummary } from "../../../shared/ipc";
import { runExtensionAction } from "../lib/extensionActions";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { ExtensionResources } from "./ExtensionResources";
import { SectionGlyph } from "./SectionGlyph";

// The Extensions page: the grouped list plus a detail pane, at full workspace
// width so names are not truncated and actions can be labelled buttons rather
// than three ambiguous icons fighting the name for 260px.
//
// The detail pane renders every action `extensionActions` (agent-core) decided
// for the selected row -- install/connect/change-workspace/configure/disconnect
// -- plus the enable/pin toggles, so this page carries full parity with the
// sidebar hub it replaces. Per-extension config-schema editing and the
// extension's own Page view remain future work; the grouping and selection
// rules here are what they would build on.
//
// The buckets, their order, and the status dot are the sidebar hub's -- ported
// rather than re-derived, because the page is now the ONLY place a user can
// read what state an extension is in. (A fifth bucket, "section", was added
// 2026-07-27 for extensions whose real state the hub cannot verify -- see
// groupOf.)
// Buckets answer ONE question -- can I use this right now? -- so they are
// ordered by how far from usable each is. An earlier scheme mixed in a
// "Has its own section" bucket, which told a user nothing (every extension has
// a section) and existed only to dodge a fabricated status; the statuses are
// real now, so the question is honest again.
const GROUPS = [
  { key: "connected", label: "Connected" },
  { key: "available", label: "Not connected" },
  { key: "absent", label: "Not installed" },
  { key: "disabled", label: "Disabled" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

// Pure: which group a summary belongs to. `enabled` is the EFFECTIVE enabled
// state (the store's optimistic pref overlaid on the polled row), so unchecking
// "Enabled" moves the row into Disabled at once instead of after the poll.
// `ready` is a Tier-1 CLI that is installed AND logged in -- it belongs with
// Connected, not Available; `error` means the probe failed, which is closer to
// Not installed than to ready-to-use.
//
// Every tier is bucketed by the SAME rule. Section extensions used to be
// exempted here, because summary.ts handed them a placeholder `status: "ready"`
// that would have filed an uninstalled Docker under "Connected". The fix then
// was a bucket of their own; the fix now is that main probes them for real
// (extensions:list), so there is nothing left to exempt.
export function groupOf(e: ExtensionSummary, enabled = e.enabled): GroupKey {
  if (!enabled) return "disabled";
  if (e.status === "ready" || e.status === "connected") return "connected";
  if (e.status === "unauthed") return "available";
  return "absent"; // absent / error / disabled-status
}

// One status -> one colour, for every tier, so a row reads the same wherever it
// appears.
//
// `unauthed` is AMBER, not the accent. It used to reuse `.status-dot.running`,
// whose colour is var(--accent) -- the exact same blue as `.on` -- so a
// not-connected row was indistinguishable from a connected one, separated only
// by a pulse animation that reads as "in progress" anyway (which is what
// .running means everywhere else: a live container, a running CI job). Amber
// says "needs you", which is what not-connected actually is.
function statusDot(e: ExtensionSummary): string {
  if (e.status === "ready" || e.status === "connected") return "status-dot on";
  if (e.status === "error") return "status-dot fail";
  if (e.status === "unauthed") return "status-dot warn"; // not connected
  return "status-dot"; // absent / disabled -> grey
}

// How the pane ARRANGES the actions agent-core decided on. Three groups so the
// pane has a visual hierarchy: one call to action, quieter alternatives, and
// destructive work fenced off in its own footer. Before this, every action
// rendered .btn.primary -- so a navigation button (Open Azure) shouted exactly
// as loudly as a real CTA (Connect Snowflake).
//
// Selection is by the `danger` FLAG rather than the "disconnect" kind, so a
// future destructive action is fenced off automatically instead of by
// remembering to edit this rule.
export function splitActions(actions: ExtensionAction[]): {
  primary: ExtensionAction | null;
  secondary: ExtensionAction[];
  danger: ExtensionAction[];
} {
  const danger = actions.filter((a) => a.danger === true);
  const rest = actions.filter((a) => a.danger !== true);
  return { primary: rest[0] ?? null, secondary: rest.slice(1), danger };
}

// The detail pane's one-line state readout. All SIX statuses get their own
// sentence: this line is the only place the state is spelled out in words, so
// "Installed, not connected." on a `ready`/`error`/`disabled` row was a claim
// the sidebar hub never made.
export function statusLine(e: ExtensionSummary, enabled: boolean): string {
  const acct = e.account ? ` · ${e.account}` : "";
  if (!enabled || e.status === "disabled")
    return `${e.name} is disabled — it is hidden from Claude and from the sidebar.`;
  switch (e.status) {
    case "absent":
      return `${e.name} is not installed.`;
    case "unauthed":
      // Tier-2 extensions are not "installed" at all -- they are a vaulted
      // token or nothing, so only the Tier-1 wording can mention installation.
      // Only a Tier-1 CLI manifest has a genuine install-THEN-login two-step.
      // A tier-2 extension is a vaulted token or nothing, and a section
      // extension is an API key (Neon, Render) or a reachable daemon (Docker)
      // -- telling a user with Docker installed but stopped that it is
      // "not signed in" names the wrong problem.
      return e.tier === "status"
        ? "Installed, not signed in."
        : "Not connected.";
    case "ready":
      return `Installed and signed in${acct}`;
    case "connected":
      return `Connected${acct}`;
    case "error":
      return `${e.name} could not be checked — it reported an error.`;
  }
}

// What to say when a row offers no buttons at all. "ready to use" is only true
// for a `ready`/`connected` row; a disabled or errored row has no actions for
// an entirely different reason.
export function noActionsNote(e: ExtensionSummary, enabled: boolean): string {
  if (!enabled || e.status === "disabled")
    return `Enable ${e.name} to see what it offers.`;
  if (e.status === "error")
    return `Nothing to do until ${e.name} can be checked again.`;
  // A Tier-1 manifest that declares no install/connect command (its sign-in
  // happens in a browser, outside AirLock) offers no button while
  // absent/unauthed either -- "ready to use" below would be exactly backwards.
  if (e.status === "absent" || e.status === "unauthed")
    return "Nothing to do here yet.";
  return `Nothing to configure — ${e.name} is ready to use.`;
}

export function ExtensionsTab() {
  const [all, setAll] = useState<ExtensionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Whether the SELECTED row's resource list is expanded, and which row that
  // answer is for. Collapsed by default, because mounting ExtensionResources
  // starts a 5s poll: for GitHub that is a live api.github.com request plus a
  // keychain read every 5 seconds. Nothing fetches until the user asks, same as
  // the sidebar hub's chevron.
  const [expanded, setExpanded] = useState(false);
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  // Collapse on ANY selection change -- a click, or a poll-driven re-pick.
  // Storing the expanded row's ID instead was not enough: it only HID the list
  // while another row was selected, so revisiting the row re-expanded it with
  // no click and silently resumed the poll.
  //
  // Done during RENDER (React's documented "adjust state when something
  // changes" pattern) rather than in an effect: an effect runs AFTER commit, so
  // one commit would slip through carrying the stale `true` -- and that is a
  // commit in which ExtensionResources mounts and fires its fetch, which is the
  // very thing this is here to prevent. Converges after one extra render
  // because expandedFor is set to the value it is compared against.
  if (expandedFor !== selected) {
    setExpandedFor(selected);
    setExpanded(false);
  }

  // The row data is polled, not pushed: connect/disconnect/install all happen
  // elsewhere (a browser tab, a terminal, another window), so a mounted page
  // has to re-ask. 5s, matching the sidebar hub this replaced -- without it,
  // Disconnect left the row reading "Connected" until you navigated away.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void window.airlock
        .extensionsList()
        .then((rows) => {
          if (cancelled) return;
          setAll(rows);
          // Auto-select only when there is NOTHING selected (or the selected
          // row vanished): a poll must never yank the user's selection. Opens
          // on the first CONNECTED extension, else the first row, else none.
          setSelected((prev) => {
            if (prev !== null && rows.some((e) => e.id === prev)) return prev;
            return (
              (rows.find((e) => groupOf(e) === "connected") ?? rows[0])?.id ??
              null
            );
          });
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const current = all.find((e) => e.id === selected) ?? null;

  const setExtensionPref = useApp((s) => s.setExtensionPref);
  const prefs = useApp((s) => s.extensionsPrefs);
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);

  // prefsSet REPLACES the whole `extensions` object, so merge the full current
  // map. The store is updated optimistically; the 5s poll reconciles.
  const applyPref = (
    id: string,
    patch: { enabled?: boolean; pinned?: boolean },
  ) => {
    const cur = useApp.getState().extensionsPrefs;
    setExtensionPref(id, patch);
    void window.airlock.prefsSet({
      extensions: { ...cur, [id]: { ...cur[id], ...patch } },
    });
  };

  // One place that turns an action into behavior -- shared with the agent path
  // (see lib/extensionActions), so a connect started by Claude and one started
  // by this button do exactly the same thing.
  const run = (e: ExtensionSummary, a: ExtensionAction) => {
    runExtensionAction(e, a, root);
  };

  // The effective enabled state -- the optimistic pref over the polled row.
  // Drives BOTH the bucket and the checkbox, so they can never disagree.
  const enabledOf = (e: ExtensionSummary) => prefs[e.id]?.enabled ?? e.enabled;

  return (
    <div className="ext-page">
      <div className="ext-page-list">
        {GROUPS.map((g) => {
          const rows = all.filter((e) => groupOf(e, enabledOf(e)) === g.key);
          if (rows.length === 0) return null;
          return (
            <div key={g.key}>
              <div className="ext-page-group">
                {g.label}
                <span className="ext-page-count">{rows.length}</span>
              </div>
              {rows.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={`ext-page-row${e.id === selected ? " active" : ""}`}
                  onClick={() => setSelected(e.id)}
                >
                  <SectionGlyph icon={e.icon ?? "extensions"} />
                  <span className={statusDot(e)} />
                  {/* Name and account are SEPARATE truncating spans. As one
                    string they wrapped -- "Azure . Azure Subscription (CSP)"
                    overflowed the fixed row height and collided with the row
                    below. The name holds its width; the account gives way. */}
                  <span className="ext-page-name">{e.name}</span>
                  {e.account && (
                    <span className="ext-page-account">{e.account}</span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="ext-page-detail">
        {current === null ? (
          <div className="section-note">Choose an extension from the list.</div>
        ) : (
          (() => {
            // current already IS the selected extension; alias it here rather
            // than re-running all.find a second time.
            const sel = current;
            const enabled = enabledOf(sel);
            const pinned = prefs[sel.id]?.pinned ?? sel.pinned;
            const actions = sel.actions ?? [];
            const { primary, secondary, danger } = splitActions(actions);
            // Same condition ExtensionsSection.tsx used to decide a row's
            // resources are worth fetching: a Tier-1 steady row that is
            // actually ready and targets a non-activity section, or any
            // connected Tier-2 row. Without this gate a row with nothing to
            // show would still offer an expander onto an empty list.
            const expandable =
              (sel.tier === "status" &&
                (sel.status === "ready" || sel.status === "connected") &&
                !!sel.category &&
                sel.category !== "activity") ||
              (sel.tier === "connected" && sel.status === "connected");
            // `expanded` is already scoped to the selection by the reset above,
            // so it needs no id comparison here.
            const resourcesOpen = expanded;
            return (
              <>
                <div className="ext-detail-head">
                  <SectionGlyph icon={sel.icon ?? "extensions"} />
                  <h2 className="ext-page-title">{sel.name}</h2>
                </div>
                <div className="ext-detail-status">
                  <span className={statusDot(sel)} />
                  <span>{statusLine(sel, enabled)}</span>
                </div>
                <div className="ext-detail-actions">
                  {primary || secondary.length > 0 ? (
                    <div className="ext-detail-buttons">
                      {primary && (
                        <button
                          key={primary.kind}
                          type="button"
                          className="btn primary"
                          onClick={() => run(sel, primary)}
                        >
                          {primary.label}
                        </button>
                      )}
                      {secondary.map((a) => (
                        <button
                          key={a.kind}
                          type="button"
                          className="btn"
                          onClick={() => run(sel, a)}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    // Say so, rather than leaving a blank pane that reads as broken.
                    <div className="section-note">
                      {noActionsNote(sel, enabled)}
                    </div>
                  )}
                  <label className="ext-detail-toggle">
                    <input
                      type="checkbox"
                      aria-label={`Enable ${sel.name}`}
                      checked={enabled}
                      onChange={(ev) =>
                        applyPref(sel.id, { enabled: ev.target.checked })
                      }
                    />
                    Enabled
                  </label>
                  {/* No category means the eye has nowhere to surface it. */}
                  {sel.category && (
                    <label className="ext-detail-toggle">
                      <input
                        type="checkbox"
                        aria-label={`${pinned ? "Hide" : "Show"} ${sel.name} ${
                          pinned ? "from" : "in"
                        } ${sel.category}`}
                        checked={pinned}
                        onChange={(ev) =>
                          applyPref(sel.id, { pinned: ev.target.checked })
                        }
                      />
                      Show in {sel.category}
                    </label>
                  )}
                </div>
                {/* Same resource list the sidebar's expandable row showed --
                  lifted to ExtensionResources.tsx so deleting the sidebar
                  doesn't delete the only place that fetched it. Behind a
                  collapsed-by-default toggle: ExtensionResources polls while
                  MOUNTED, so mounting it unasked would turn merely opening this
                  page into a 5s API + keychain loop. */}
                {expandable && (
                  <>
                    <button
                      type="button"
                      className="ext-detail-expand"
                      aria-expanded={resourcesOpen}
                      aria-label={`${resourcesOpen ? "Collapse" : "Expand"} ${sel.name} resources`}
                      onClick={() => setExpanded(!resourcesOpen)}
                    >
                      <i
                        className={`codicon codicon-chevron-${resourcesOpen ? "down" : "right"}`}
                      />
                      <span>Resources</span>
                    </button>
                    {resourcesOpen && (
                      <ExtensionResources
                        id={sel.id}
                        name={sel.name}
                        category={sel.category ?? ""}
                        connected={sel.tier === "connected"}
                      />
                    )}
                  </>
                )}
                {/* Slot 6. Destructive work, fenced off below a rule -- it used
                    to sit inline with the ordinary buttons at the same size,
                    separated only by colour. */}
                {danger.length > 0 && (
                  <div className="ext-detail-danger">
                    {danger.map((a) => (
                      <button
                        key={a.kind}
                        type="button"
                        className="btn danger"
                        onClick={() => run(sel, a)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}
