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
// this ONE manifest by id, account-wide, with no pin/relevance gate (unlike
// integrations:steady), and -- since the 2026-07-27 fix to
// steadyIntegrationFor -- works for a manifest regardless of its surface, so
// it also serves Vercel (Activity-surfaced; contributes no Databases/Host
// provider row, but still has a real detect status and current items). Polls
// every 5s while mounted, matching sibling sections.
//
// Every state names a true reason, per the design's error table: CLI not
// found (absent) / installed but not signed in (unauthed) / its resources,
// however many that is (ready) -- never a bare empty state.
export function ManifestExtensionSection({ id }: { id: string }) {
  const [data, setData] = useState<SteadyIntegration | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    const load = () =>
      void window.airlock
        .integrationsResources(id)
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
