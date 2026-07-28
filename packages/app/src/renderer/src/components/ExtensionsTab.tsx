import { useCallback, useEffect, useState } from "react";
import type { ExtensionAction, ExtensionSummary } from "../../../shared/ipc";
import { runExtensionAction } from "../lib/extensionActions";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { ExtensionResources } from "./ExtensionResources";
import { GithubAccountRows } from "./GithubAccountRows";
import { Loading } from "./Loading";
import { SectionGlyph } from "./SectionGlyph";
import { Switch } from "./Switch";

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

// The one-line explanation under the per-project use switch. Each state names
// the reason it is in, so the switch is never a bare checkbox the user has to
// reverse-engineer -- and the "signal" copy exists specifically to explain why
// the switch beside it is not clickable.
function projectUseNote(e: ExtensionSummary): string {
  // Deliberately does not name the signal. Which one matched lives in the
  // manifest, and the section already spells it out on the state where it
  // matters (irrelevant). Here the useful fact is only that SOMETHING matched,
  // which is why the switch cannot be turned off.
  if (e.projectUse === "signal")
    return "Detected in this project, so it shows here either way.";
  if (e.projectUse === "optedIn") return "Shown here because you turned it on.";
  return "Not detected in this project.";
}

export function ExtensionsTab() {
  // null = NOT ASKED YET, which is a different answer from [] ("asked, and
  // there are none"). Conflating them is what painted a finished-looking empty
  // page for up to 8s while extensions:list probed the CLIs.
  const [all, setAll] = useState<ExtensionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Whether the SELECTED row's resource list is expanded, and which row that
  // answer is for. Collapsed by default, because mounting ExtensionResources
  // starts a 5s poll: for GitHub that is a live api.github.com request plus a
  // keychain read every 5 seconds. Nothing fetches until the user asks, same as
  // the sidebar hub's chevron.
  const [expanded, setExpanded] = useState(false);
  // The pooled Slack workspaces, for the one-click reuse buttons. Refs only --
  // the tokens stay in main.
  const [slackPool, setSlackPool] = useState<
    { id: string; name: string; domain: string }[] | null
  >(null);
  useEffect(() => {
    void window.airlock
      .slackWorkspaces()
      .then(setSlackPool)
      .catch(() => setSlackPool([]));
  }, []);
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
  // Hoisted out of the effect so a setting that changes a row (the per-project
  // use switch) can re-read at once rather than showing its old value until the
  // next tick -- a 5s lag on a switch reads as the switch not working.
  const reload = useCallback(
    () =>
      window.airlock
        .extensionsList()
        .then((rows) => {
          // Always a value, never back to null: a poll must not send the page
          // to loading, or the spinner would flash every 5s forever.
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
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (!cancelled) void reload();
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [reload]);

  // Both first-paint fetches gate the spinner: showing the list while the
  // Slack pool is still arriving would pop the reuse buttons in a beat later,
  // which is the same popping this is meant to remove.
  const loading = all === null || slackPool === null;
  const rows = all ?? [];
  const pool = slackPool ?? [];
  const current = rows.find((e) => e.id === selected) ?? null;

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

  // Everything the first paint needs, or nothing. Rendering the page
  // half-populated is the popping this replaces.
  if (loading) {
    return (
      <div className="ext-page">
        <Loading label="Loading extensions" size="page" />
      </div>
    );
  }

  return (
    <div className="ext-page">
      <div className="ext-page-list">
        {GROUPS.map((g) => {
          const inGroup = rows.filter(
            (e) => groupOf(e, enabledOf(e)) === g.key,
          );
          if (inGroup.length === 0) return null;
          return (
            <div key={g.key}>
              <div className="ext-page-group">
                {g.label}
                <span className="ext-page-count">{inGroup.length}</span>
              </div>
              {inGroup.map((e) => (
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
            const actions = sel.actions ?? [];
            // A pooled workspace this project is not using yet is a ONE-CLICK
            // connect: the token already exists in main, so no browser and no
            // credential handling. Offered only while this project is NOT
            // connected, and never applied automatically -- the click is what
            // keeps projects isolated.
            const reuse: ExtensionAction[] =
              sel.id === "slack" && sel.status === "unauthed"
                ? pool.map((w) => ({
                    kind: "useAccount" as const,
                    label: `Use ${w.name}`,
                    accountId: w.id,
                  }))
                : [];
            // reuse FIRST, so the first pooled workspace becomes the primary
            // button and "Connect a different workspace" drops to secondary.
            const { primary, secondary, danger } = splitActions([
              ...reuse,
              ...actions,
            ]);
            // Whether the extension is in a state where resources could exist
            // at all -- drives the Resources slot's not-connected branch.
            const usable = sel.status === "ready" || sel.status === "connected";
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
                </div>
                {/* Slot 4. ALWAYS rendered, so a pane carrying one toggle has
                    the same shape as a pane carrying two. The distinction this
                    layout draws throughout: the SLOT is fixed, the controls
                    inside it follow the data. */}
                <div className="ext-detail-settings">
                  <div className="ext-detail-label">Settings</div>
                  <Switch
                    label="Enabled"
                    ariaLabel={`Enable ${sel.name}`}
                    checked={enabled}
                    onChange={(v) => applyPref(sel.id, { enabled: v })}
                  />
                  {/* The per-project opt-in, for any extension that CAN be
                      irrelevant (main sets projectUse only for a manifest that
                      declares a `relevance` spec). Its counterpart is the
                      "Use <name> here" button on an irrelevant section, which
                      is one-way -- this is where it comes back off.

                      Note the two switches in this slot write to DIFFERENT
                      stores: Enabled is an app pref (everywhere), this is
                      project config (here). The labels have to carry that,
                      since nothing else in the layout does. */}
                  {sel.projectUse && (
                    <>
                      <Switch
                        label="Use in this project"
                        ariaLabel={`Use ${sel.name} in this project`}
                        checked={sel.projectUse !== "none"}
                        // A declared signal already makes the project relevant,
                        // so turning the override off would hide nothing. An
                        // interactive switch there is the deleted "Show in
                        // {category}" mistake: a control that visibly does
                        // nothing.
                        disabled={sel.projectUse === "signal"}
                        onChange={(v) => {
                          // Not just belt-and-braces: `disabled` is a DOM
                          // affordance, and React drives a checkbox's onChange
                          // off the click event without consulting it -- so a
                          // programmatic click still lands here. The invariant
                          // is "a settled switch writes nothing", so it is
                          // enforced where the write happens.
                          if (sel.projectUse === "signal") return;
                          if (!root) return;
                          void window.airlock
                            .extensionsSetProjectUse(root, sel.id, v)
                            .then(() => reload())
                            .catch((err) =>
                              console.error(
                                "extensionsSetProjectUse failed",
                                sel.id,
                                err,
                              ),
                            );
                        }}
                      />
                      <div className="section-note">{projectUseNote(sel)}</div>
                    </>
                  )}
                  {/* GitHub's accounts live in `gh`, not in AirLock -- this
                      surfaces the switch the accounts popover already has, so
                      the hub stops being the one place that cannot reach it. */}
                  {sel.id === "github" && <GithubAccountRows root={root} />}
                  {/* There is deliberately no "Show in {category}" switch.
                      Databases and Host are ROUTERS: every provider row is
                      ALWAYS present and always states a reason, so nothing can
                      hide one -- a switch claiming to would be a lie, which is
                      exactly what it became. It wrote the `pinned` pref, whose
                      only readers (integrations:steady and extensions:resources)
                      lost their callers when the routers were rewritten to
                      ProviderRows, so toggling it changed nothing at all. */}
                </div>
                {/* Slot 5. ALWAYS rendered, in four mutually exclusive states.
                  THE ORDER MATTERS, because two of them overlap: Neon is both
                  hasSection AND not connected, and must get the not-connected
                  answer -- pointing a user at a section that currently lists
                  nothing is technically true and useless.

                  The inline list is the same one the sidebar's expandable row
                  showed, lifted to ExtensionResources.tsx so deleting the
                  sidebar didn't delete the only place that fetched it. It stays
                  behind a collapsed-by-default toggle: ExtensionResources polls
                  while MOUNTED, so mounting it unasked would turn merely
                  selecting a row into a 5s API + keychain loop. */}
                <div className="ext-detail-resources">
                  {expandable ? (
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
                  ) : !usable ? (
                    <div className="section-note">
                      Resources appear once {sel.name} is connected.
                    </div>
                  ) : sel.hasSection ? (
                    <div className="section-note">
                      {sel.name}'s resources are shown in its own section.
                    </div>
                  ) : (
                    <div className="section-note">No resources.</div>
                  )}
                </div>
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
