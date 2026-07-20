import { useEffect, useMemo, useState } from "react";
import type { ExtensionSummary, IntegrationItem } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { ResourceRow } from "./ResourceRow";

// The Extension Hub's sidebar surface: ONE compact list of every integration
// (Tier-1 status manifests today; Tier-2 connected extensions later), grouped by
// state. This is the default home -- an integration only ALSO appears under its
// category view (Host/Databases) when the user pins it here.

type Bucket = "Connected" | "Available" | "Not installed" | "Disabled";
const BUCKET_ORDER: Bucket[] = [
  "Connected",
  "Available",
  "Not installed",
  "Disabled",
];

function statusDot(status: ExtensionSummary["status"]): string {
  if (status === "ready" || status === "connected") return "status-dot on";
  if (status === "error") return "status-dot fail";
  if (status === "unauthed") return "status-dot running"; // available, not yet connected
  return "status-dot"; // absent / disabled -> grey
}

function bucketFor(
  status: ExtensionSummary["status"],
  enabled: boolean,
): Bucket {
  if (!enabled) return "Disabled";
  if (status === "ready" || status === "connected") return "Connected";
  if (status === "unauthed") return "Available";
  return "Not installed"; // absent / error
}

export function ExtensionsSection() {
  const [items, setItems] = useState<ExtensionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Overlay the store's (optimistic) prefs on the polled rows so enable/pin
  // toggles feel instant; the 5s poll reconciles afterwards.
  const prefs = useApp((s) => s.extensionsPrefs);
  const setExtensionPref = useApp((s) => s.setExtensionPref);
  const setModal = useApp((s) => s.setModal);
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  // Which connected steady rows are expanded (id set). Expanding a row fetches
  // that integration's resources on demand (see ExtensionResources) -- nothing
  // polls until the user opens a row.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Tier-2 connect/disconnect. v1 has one connected extension (Slack); the
  // connect flow opens its modal. disconnect removes the vaulted token (the
  // 5s poll then flips the row back to "Available").
  const disconnect = (id: string) => {
    if (root) void window.airlock.extensionsDisconnect(root, id);
  };

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void window.airlock
        .extensionsList()
        .then((all) => {
          if (cancelled) return;
          setItems(all);
          setLoaded(true);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Persist a pref change: merge the FULL current map (prefsSet replaces the
  // whole `extensions` object) and update the store optimistically.
  const applyPref = (
    id: string,
    patch: { enabled?: boolean; pinned?: boolean },
  ) => {
    const cur = useApp.getState().extensionsPrefs;
    const merged = { ...cur, [id]: { ...cur[id], ...patch } };
    setExtensionPref(id, patch);
    void window.airlock.prefsSet({ extensions: merged });
  };

  const groups = useMemo(() => {
    const by: Record<Bucket, ExtensionSummary[]> = {
      Connected: [],
      Available: [],
      "Not installed": [],
      Disabled: [],
    };
    for (const s of items) {
      const enabled = prefs[s.id]?.enabled ?? s.enabled;
      by[bucketFor(s.status, enabled)].push(s);
    }
    return by;
  }, [items, prefs]);

  if (loaded && items.length === 0) {
    return (
      <div className="databases">
        <div className="section-empty">No integrations available.</div>
      </div>
    );
  }

  return (
    <div className="databases">
      {BUCKET_ORDER.filter((b) => groups[b].length > 0).map((bucket) => (
        <div key={bucket} className="db-entry">
          <div className="sb-section-head">
            <span>{bucket}</span>
            <span className="sb-badge">{groups[bucket].length}</span>
          </div>
          {groups[bucket].map((s) => {
            const enabled = prefs[s.id]?.enabled ?? s.enabled;
            const pinned = prefs[s.id]?.pinned ?? s.pinned;
            // Rows that can expand to a resource list: Tier-1 steady CLI
            // integrations (Azure/Snowflake, under Host/Databases) and Tier-2
            // connected extensions (Slack/GitHub) once connected.
            const expandable =
              (s.tier === "status" &&
                (s.status === "ready" || s.status === "connected") &&
                !!s.category &&
                s.category !== "activity") ||
              (s.tier === "connected" && s.status === "connected");
            const isOpen = open.has(s.id);
            return (
              <div key={s.id} className="ext-item">
                <div className={`db-row ext-row${enabled ? "" : " disabled"}`}>
                  {expandable ? (
                    <button
                      type="button"
                      className="ext-expand"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${s.name}`}
                      onClick={() => toggleOpen(s.id)}
                    >
                      <i
                        className={`codicon codicon-chevron-${isOpen ? "down" : "right"}`}
                      />
                    </button>
                  ) : (
                    <span className="ext-expand-spacer" aria-hidden />
                  )}
                  <i className={`codicon codicon-${s.icon ?? "plug"}`} />
                  <span className={statusDot(s.status)} />
                  <span className="db-name">
                    {s.name}
                    {s.account ? ` · ${s.account}` : ""}
                  </span>
                  <span className="ext-actions">
                    {s.status === "absent" && s.install && (
                      <button
                        type="button"
                        className="row-action ext-col-conn"
                        aria-label={`Install ${s.name}`}
                        title={s.install.command}
                        onClick={() => {
                          const c = s.install?.command;
                          if (c) useApp.getState().runInNewTerminal(c);
                        }}
                      >
                        <i className="codicon codicon-desktop-download" />
                      </button>
                    )}
                    {s.status === "unauthed" && s.connect && (
                      <button
                        type="button"
                        className="row-action ext-col-conn"
                        aria-label={`Connect ${s.name}`}
                        title={s.connect.command}
                        onClick={() => {
                          const c = s.connect?.command;
                          if (c) useApp.getState().runInNewTerminal(c);
                        }}
                      >
                        <i className="codicon codicon-plug" />
                      </button>
                    )}
                    {s.tier === "connected" && s.status === "unauthed" && (
                      <button
                        type="button"
                        className="row-action ext-col-conn"
                        aria-label={`Connect ${s.name}`}
                        title={`Connect ${s.name}`}
                        onClick={() => {
                          if (s.authKind === "oauth2")
                            setModal({
                              oauthDevice: { id: s.id, name: s.name },
                            });
                          else if (s.id === "slack") setModal("connect-slack");
                        }}
                      >
                        <i className="codicon codicon-plug" />
                      </button>
                    )}
                    {s.tier === "connected" && s.status === "connected" && (
                      <>
                        {s.id === "slack" && (
                          <button
                            type="button"
                            className="row-action ext-col-swap"
                            aria-label="Change Slack workspace"
                            title="Change workspace"
                            onClick={() =>
                              setModal({
                                oauthDevice: {
                                  id: s.id,
                                  name: s.name,
                                  manage: true,
                                },
                              })
                            }
                          >
                            <i className="codicon codicon-arrow-swap" />
                          </button>
                        )}
                        {/* Configure: only when the extension actually has a
                          config schema (hasConfig). Slack = channel allow-list;
                          GitHub has none yet (Phase A), so no gear -- it was a
                          dead button that did nothing on click. */}
                        {s.hasConfig && (
                          <button
                            type="button"
                            className="row-action ext-col-config"
                            aria-label={`Configure ${s.name}`}
                            title={`Configure ${s.name}`}
                            onClick={() => {
                              if (s.id === "slack") setModal("slack-channels");
                            }}
                          >
                            <i className="codicon codicon-settings-gear" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="row-action ext-col-conn"
                          aria-label={`Disconnect ${s.name}`}
                          title={`Disconnect ${s.name}`}
                          onClick={() => disconnect(s.id)}
                        >
                          <i className="codicon codicon-debug-disconnect" />
                        </button>
                      </>
                    )}
                    {s.category && (
                      <button
                        type="button"
                        className={`row-action ext-col-pin${pinned ? "" : " reveal"}`}
                        aria-label={`${pinned ? "Hide" : "Show"} ${s.name} ${
                          pinned ? "from" : "in"
                        } sidebar`}
                        title={
                          pinned
                            ? `Shown in ${s.category}`
                            : `Show in ${s.category}`
                        }
                        onClick={() => applyPref(s.id, { pinned: !pinned })}
                      >
                        <i
                          className={`codicon codicon-${pinned ? "eye" : "eye-closed"}`}
                        />
                      </button>
                    )}
                    {/* Trailing controls are a fixed-column grid (see theme.css):
                      each action type owns a column (swap / configure /
                      connect-or-disconnect / pin), so the same icon lines up
                      vertically across rows. The enable checkbox is the last
                      column -- flush-right on every row. */}
                    <input
                      type="checkbox"
                      aria-label={`Enable ${s.name}`}
                      checked={enabled}
                      onChange={(e) =>
                        applyPref(s.id, { enabled: e.target.checked })
                      }
                    />
                  </span>
                </div>
                {expandable && isOpen && (
                  <ExtensionResources
                    id={s.id}
                    name={s.name}
                    category={s.category ?? ""}
                    connected={s.tier === "connected"}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// The expanded body under an expandable row: fetches that integration's
// resources on demand and renders them with the shared ResourceRow. The source
// depends on the tier -- Tier-2 connected extensions (Slack/GitHub) are
// root-scoped via extensions:resourcesFor; Tier-1 steady CLI integrations
// (Azure/Snowflake) are account-wide via integrations:resources. Polls while
// open, stops on unmount (collapse). `items === null` = still loading.
function ExtensionResources({
  id,
  name,
  category,
  connected,
}: {
  id: string;
  name: string;
  category: string;
  connected: boolean;
}) {
  const [items, setItems] = useState<IntegrationItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const p = connected
        ? window.airlock.extensionsResourcesFor(id)
        : window.airlock
            .integrationsResources(id)
            .then((r) => r?.resources ?? []);
      void p
        .then((rs) => {
          if (!cancelled) setItems(rs);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id, connected]);

  const viewLabel = category
    ? category.charAt(0).toUpperCase() + category.slice(1)
    : "sidebar";
  return (
    <div className="neon-children ext-resources">
      {items === null ? (
        <div className="section-note">Loading…</div>
      ) : items.length === 0 ? (
        <div className="section-note">No resources</div>
      ) : (
        items.map((r) => <ResourceRow key={r.id} r={r} />)
      )}
      <div className="section-note">
        {connected
          ? `Also shown in the ${viewLabel} section when pinned.`
          : `Also shown in the ${viewLabel} view for projects that use ${name}.`}
      </div>
    </div>
  );
}
