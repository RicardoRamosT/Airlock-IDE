import { useEffect, useState } from "react";
import type { SteadyIntegration } from "../../../shared/ipc";
import { useApp } from "../store";
import { ResourceRow } from "./ResourceRow";

// The section for a manifest-driven extension that owns a rail icon but has no
// bespoke UI of its own (Snowflake, Azure, Vercel) -- registered per id in
// lib/extensionViews.ts. Fixes the CRITICAL finding that these three rail
// icons, which the extensions reorganization made ALWAYS visible, fell through
// to ExtensionResourcesSection's generic fallback, which calls
// extensions:resourcesFor and always returns [] for a manifest id (that IPC
// only knows Tier-2 CONNECTED_PROVIDERS, e.g. slack/github) -- a permanent
// "Nothing to show yet." with no reason, for every one of these three.
//
// integrations:resources(id) is the right data source instead: it detects
// this ONE manifest by id and -- since the 2026-07-27 fix to
// steadyIntegrationFor -- works for a manifest regardless of its surface, so
// it also serves an Activity-surfaced manifest (which contributes no
// Databases/Host provider row, but still has a real detect status and current
// items). Polls every 5s while mounted, matching sibling sections.
//
// It is called with `scoped: true` because THIS SECTION BELONGS TO ONE
// PROJECT. `az webapp list` / `snow SHOW WAREHOUSES` are account-wide, so
// without the scope flag a project that does not use Azure listed every web
// app in the subscription -- in practice another project's. The Extension Hub
// calls the same IPC without the flag and stays account-wide on purpose.
//
// Every state names a true reason, per the design's error table: not used in
// this project (irrelevant) / CLI not found (absent) / installed but not
// signed in (unauthed) / its resources, however many that is (ready) -- never
// a bare empty state.
// What would make this project relevant, in the manifest's own terms. Derived
// from the `relevance` spec rather than hardcoded per extension, so Snowflake
// (which declares an env prefix and NO files) does not get told to add a file
// that would mean nothing. Typed off SteadyIntegration so no agent-core import
// is needed here -- the renderer must never value-import that package, and a
// type-only import is easy to convert by accident.
export function relevanceHint(r: SteadyIntegration["relevance"]): string {
  const file = r?.files?.[0];
  const prefix = r?.envPrefix;
  if (file && prefix)
    return `Add ${file} to the project root, or vault a secret starting with ${prefix}.`;
  if (file) return `Add ${file} to the project root.`;
  if (prefix) return `Vault a secret starting with ${prefix}.`;
  // Unreachable via the handler: only a manifest WITH a relevance spec can be
  // irrelevant. Kept so a future spec shape cannot render an empty line.
  return "It has no project signal configured.";
}

export function ManifestExtensionSection({ id }: { id: string }) {
  const [data, setData] = useState<SteadyIntegration | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    const load = () =>
      void window.airlock
        .integrationsResources(id, true)
        .then((r) => {
          if (!cancelled) setData(r);
        })
        .catch(() => {
          if (!cancelled) setData(null);
        });
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id]);

  // Still waiting on the first response -- a reason, not a blank panel.
  if (data === undefined) {
    return <div className="section-note">Checking…</div>;
  }
  // integrations:resources only returns null for an id it does not recognize
  // as a manifest at all; every id this component is registered for IS one, so
  // this is a defensive fallback, not a state a user should ever reach.
  if (data === null) {
    return <div className="section-note">Status unavailable.</div>;
  }

  // Before absent: this project simply does not use the tool, which is a
  // different (and more common) answer than "the CLI is missing" -- the CLI may
  // well be installed and signed in for another project. There is nothing to
  // install and nothing to connect, so the section offers no button; it names
  // the signal that would make this project relevant instead.
  if (data.status === "irrelevant") {
    return (
      <div className="sb-card">
        <span className="section-note">
          {data.name} isn't used in this project.
        </span>
        <span className="section-note">{relevanceHint(data.relevance)}</span>
      </div>
    );
  }

  if (data.status === "absent") {
    return (
      <div className="sb-card">
        <span className="section-note">{data.name} is not installed.</span>
        {data.install?.command && (
          <button
            type="button"
            className="btn primary"
            title={data.install.command}
            onClick={() => {
              const c = data.install?.command;
              if (c) useApp.getState().runInNewTerminal(c);
            }}
          >
            Install {data.name} CLI
          </button>
        )}
      </div>
    );
  }

  if (data.status === "unauthed") {
    return (
      <div className="sb-card">
        <span className="section-note">Installed, not signed in.</span>
        {data.connect?.command && (
          <button
            type="button"
            className="btn primary"
            title={data.connect.command}
            onClick={() => {
              const c = data.connect?.command;
              if (c) useApp.getState().runInNewTerminal(c);
            }}
          >
            Connect {data.name}
          </button>
        )}
      </div>
    );
  }

  // ready
  return (
    <div className="databases">
      {data.resources.length === 0 ? (
        <div className="section-note">No resources.</div>
      ) : (
        data.resources.map((r) => <ResourceRow key={r.id} r={r} />)
      )}
    </div>
  );
}

// Thin, no-props wrappers so each can be registered directly in
// EXTENSION_VIEWS (whose Sidebar slot is a zero-prop FC, matching
// NeonSection/DockerSection/RenderSection).
export function SnowflakeSection() {
  return <ManifestExtensionSection id="snowflake" />;
}

export function AzureSection() {
  return <ManifestExtensionSection id="azure" />;
}
