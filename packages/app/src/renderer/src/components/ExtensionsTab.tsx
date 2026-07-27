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
const GROUPS = [
  { key: "connected", label: "Connected" },
  { key: "available", label: "Available" },
  { key: "absent", label: "Not installed" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

// Pure: which group a summary belongs to.
export function groupOf(e: ExtensionSummary): GroupKey {
  if (e.status === "absent") return "absent";
  if (e.status === "connected") return "connected";
  return "available";
}

export function ExtensionsTab() {
  const [all, setAll] = useState<ExtensionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.airlock
      .extensionsList()
      .then((rows) => {
        if (cancelled) return;
        setAll(rows);
        // Open on the first CONNECTED extension, else the first row, else none.
        setSelected(
          (rows.find((e) => groupOf(e) === "connected") ?? rows[0])?.id ?? null,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
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
        setModal("connect-slack");
        break;
      case "changeWorkspace":
        setModal({ oauthDevice: { id: e.id, name: e.name, manage: true } });
        break;
      case "configure":
        setModal("slack-channels");
        break;
      case "disconnect":
        if (root) void window.airlock.extensionsDisconnect(root, e.id);
        break;
    }
  };

  return (
    <div className="ext-page">
      <div className="ext-page-list">
        {GROUPS.map((g) => {
          const rows = all.filter((e) => groupOf(e) === g.key);
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
                  <span>{e.name}</span>
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
          <>
            <h2 className="ext-page-title">{current.name}</h2>
            <div className="section-note">
              {current.status === "absent"
                ? `${current.name} is not installed.`
                : current.status === "connected"
                  ? `Connected${current.account ? ` · ${current.account}` : ""}`
                  : "Installed, not connected."}
            </div>
            {(() => {
              // current already IS the selected extension (line above); alias
              // it here rather than re-running all.find a second time.
              const sel = current;
              if (!sel) return null;
              const enabled = prefs[sel.id]?.enabled ?? sel.enabled;
              const pinned = prefs[sel.id]?.pinned ?? sel.pinned;
              const actions = sel.actions ?? [];
              // Same condition ExtensionsSection.tsx uses to decide a row's
              // resources are worth fetching: a Tier-1 steady row that is
              // actually ready and targets a non-activity section, or any
              // connected Tier-2 row. Without this gate a row with nothing to
              // show would still poll for an empty list.
              const expandable =
                (sel.tier === "status" &&
                  (sel.status === "ready" || sel.status === "connected") &&
                  !!sel.category &&
                  sel.category !== "activity") ||
                (sel.tier === "connected" && sel.status === "connected");
              return (
                <>
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
                        Nothing to configure — {sel.name} is ready to use.
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
                    doesn't delete the only place that fetched it. */}
                  {expandable && (
                    <ExtensionResources
                      id={sel.id}
                      name={sel.name}
                      category={sel.category ?? ""}
                      connected={sel.tier === "connected"}
                    />
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
