import { useEffect, useState } from "react";
import type { ExtensionAction, ExtensionSummary } from "../../../shared/ipc";
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
const GROUPS = [
  { key: "connected", label: "Connected" },
  // Section extensions (Docker, Neon, Render, ...) are not verified at this
  // layer -- see the tier === "section" note on groupOf. Its own bucket, between
  // Connected and Available, keeps it from being read as either "confirmed
  // connected" or "confirmed available but not connected", neither of which the
  // hub can back up.
  { key: "section", label: "Has its own section" },
  { key: "available", label: "Available" },
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
// tier === "section" (Docker, Neon, Render, Snowflake, Azure, Vercel as
// SECTION_EXTENSIONS descriptors) is checked BEFORE any of that: summary.ts
// hands these rows a placeholder `status: "ready"` because it deliberately does
// not know their real liveness (that lives in their own section). Filing them
// under "Connected" on the strength of that placeholder is exactly the bug
// this branch fixes -- a user who never installed Docker was shown "Connected".
export function groupOf(e: ExtensionSummary, enabled = e.enabled): GroupKey {
  if (!enabled) return "disabled";
  if (e.tier === "section") return "section";
  if (e.status === "ready" || e.status === "connected") return "connected";
  if (e.status === "unauthed") return "available";
  return "absent"; // absent / error / disabled-status
}

// The sidebar hub's mapping, unchanged for tiers it can actually verify, so a
// status reads the same colour wherever it appears. A tier === "section" row
// is excluded from that promise on purpose: its placeholder "ready" status (see
// summary.ts) is not something this layer can verify, so painting it green
// would assert a connection state the hub cannot back up. Grey is the honest
// answer -- the same "nothing claimed" grey absent/disabled already use.
function statusDot(e: ExtensionSummary): string {
  if (e.tier === "section") return "status-dot";
  if (e.status === "ready" || e.status === "connected") return "status-dot on";
  if (e.status === "error") return "status-dot fail";
  if (e.status === "unauthed") return "status-dot running"; // available, not connected
  return "status-dot"; // absent / disabled -> grey
}

// The detail pane's one-line state readout. All SIX statuses get their own
// sentence: this line is the only place the state is spelled out in words, so
// "Installed, not connected." on a `ready`/`error`/`disabled` row was a claim
// the sidebar hub never made.
export function statusLine(e: ExtensionSummary, enabled: boolean): string {
  const acct = e.account ? ` · ${e.account}` : "";
  if (!enabled || e.status === "disabled")
    return `${e.name} is disabled — it is hidden from Claude and from the sidebar.`;
  // A section extension's placeholder "ready" status (see summary.ts) is not
  // something this layer verified, so "Installed and signed in" -- the case
  // below for a genuinely-detected Tier-1 CLI -- would be a claim the hub
  // cannot back up. Point at the truth instead: its own section.
  if (e.tier === "section")
    return `${e.name} has its own section, where its real state is shown.`;
  switch (e.status) {
    case "absent":
      return `${e.name} is not installed.`;
    case "unauthed":
      // Tier-2 extensions are not "installed" at all -- they are a vaulted
      // token or nothing, so only the Tier-1 wording can mention installation.
      return e.tier === "connected"
        ? "Not connected."
        : "Installed, not signed in.";
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
  // Mirrors statusLine's tier check: "ready to use" below would be the same
  // unverifiable claim for a section extension that statusLine already avoids.
  if (e.tier === "section")
    return `${e.name} has no actions here -- manage it from its own section.`;
  if (e.status === "error")
    return `Nothing to do until ${e.name} can be checked again.`;
  // A Tier-1 manifest with no install/connect command declared (Vercel: only a
  // browser login outside AirLock) offers no button while absent/unauthed
  // either -- "ready to use" below would be exactly backwards. Found while
  // re-checking this file for the 2026-07-27 duplicate-row fix: Vercel's
  // manifest row is now the ONLY row a user sees for it (see
  // mergeSectionExtensions), where before it could sit unnoticed beside the
  // always-"ready" section row.
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

  const setModal = useApp((s) => s.setModal);
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

  // One place that turns an action into behavior. The DECISION of which actions
  // exist is agent-core's (extensionActions); this only performs them.
  const run = (e: ExtensionSummary, a: ExtensionAction) => {
    switch (a.kind) {
      case "install":
      case "connectCli":
        // User-initiated: the command is put in a terminal, never auto-run.
        if (a.command) useApp.getState().runInNewTerminal(a.command);
        break;
      case "connectOauth":
        setModal({ oauthDevice: { id: e.id, name: e.name } });
        break;
      case "connectToken":
        // Slack owns the only paste-a-token modal there is. Guarded, so a
        // future token extension does nothing here rather than opening the
        // WRONG extension's connect flow.
        if (e.id === "slack") setModal("connect-slack");
        break;
      case "changeWorkspace":
        setModal({ oauthDevice: { id: e.id, name: e.name, manage: true } });
        break;
      case "configure":
        // Likewise: "slack-channels" is Slack's allow-list, not a generic
        // config editor. Per-extension config-schema editing is future work.
        if (e.id === "slack") setModal("slack-channels");
        break;
      case "disconnect":
        if (root) void window.airlock.extensionsDisconnect(root, e.id);
        break;
    }
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
              <div className="sb-section-head">
                {g.label} <span className="sb-badge">{rows.length}</span>
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
                  {/* The account (Slack workspace / Azure subscription) rides
                    beside the name, as it did in the sidebar hub: with two
                    accounts of the same extension the name alone is ambiguous. */}
                  <span>
                    {e.name}
                    {e.account ? ` · ${e.account}` : ""}
                  </span>
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
                <h2 className="ext-page-title">{sel.name}</h2>
                <div className="section-note">
                  <span className={statusDot(sel)} /> {statusLine(sel, enabled)}
                </div>
                <div className="ext-detail-actions">
                  {actions.length > 0 ? (
                    <div className="ext-detail-buttons">
                      {actions.map((a) => (
                        <button
                          key={a.kind}
                          type="button"
                          className={`btn${a.danger ? " danger" : " primary"}`}
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
                  <label className="oauth-optin">
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
                    <label className="oauth-optin">
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
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}
