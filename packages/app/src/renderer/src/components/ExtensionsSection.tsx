import { useEffect, useMemo, useState } from "react";
import type { ExtensionSummary } from "../../../shared/ipc";
import { useApp } from "../store";

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
          <div className="section-note">{bucket}</div>
          {groups[bucket].map((s) => {
            const enabled = prefs[s.id]?.enabled ?? s.enabled;
            const pinned = prefs[s.id]?.pinned ?? s.pinned;
            return (
              <div
                key={s.id}
                className={`db-row ext-row${enabled ? "" : " disabled"}`}
              >
                <i className={`codicon codicon-${s.icon ?? "plug"}`} />
                <span className={statusDot(s.status)} />
                <span className="db-name">{s.name}</span>
                <span className="ext-actions">
                  {s.status === "absent" && s.install && (
                    <button
                      type="button"
                      className="row-action"
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
                      className="row-action"
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
                  <input
                    type="checkbox"
                    aria-label={`Enable ${s.name}`}
                    checked={enabled}
                    onChange={(e) =>
                      applyPref(s.id, { enabled: e.target.checked })
                    }
                  />
                  {s.category && (
                    <button
                      type="button"
                      className={`row-action${pinned ? "" : " reveal"}`}
                      aria-label={`${pinned ? "Unpin" : "Pin"} ${s.name} ${
                        pinned ? "from" : "to"
                      } sidebar`}
                      title={
                        pinned
                          ? `Shown under ${s.category}`
                          : `Pin under ${s.category}`
                      }
                      onClick={() => applyPref(s.id, { pinned: !pinned })}
                    >
                      <i
                        className={`codicon codicon-${pinned ? "pinned" : "pin"}`}
                      />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
