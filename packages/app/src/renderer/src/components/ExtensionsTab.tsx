import { useEffect, useState } from "react";
import type { ExtensionSummary } from "../../../shared/ipc";
import { SectionGlyph } from "./SectionGlyph";

// The Extensions page: the grouped list plus a detail pane, at full workspace
// width so names are not truncated and actions can be labelled buttons rather
// than three ambiguous icons fighting the name for 260px.
//
// This is the MINIMAL body. Part 2 fills the detail pane with per-extension
// configuration, what Claude can read through it, and the extension's own Page
// view; the grouping and selection rules here are what it builds on.
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
          </>
        )}
      </div>
    </div>
  );
}
