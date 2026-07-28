import { useCallback, useEffect, useState } from "react";
import type { SteadyIntegration } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { Loading } from "./Loading";
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
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);

  // Kept out of the effect so the opt-in click can re-read IMMEDIATELY. Waiting
  // out the 5s poll would make the click look like it did nothing, which is the
  // same dead end in a slower costume.
  const load = useCallback(
    () =>
      window.airlock
        .integrationsResources(id, true)
        .then((r) => r)
        .catch(() => null),
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    const tick = () =>
      void load().then((r) => {
        if (!cancelled) setData(r);
      });
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [load]);

  // NOT named `useHere`: biome's rules-of-hooks lint reads any `use*` call as a
  // hook and rejects it inside the click handler. The CONFIG key is still
  // `useHere`; only this local reads differently.
  const optIn = async () => {
    if (!root) return;
    try {
      await window.airlock.extensionsSetProjectUse(root, id, true);
    } catch (err) {
      // Leave the card as it is: claiming the project opted in when the config
      // write failed is worse than a click that visibly did nothing.
      console.error("extensionsSetProjectUse failed", id, err);
      return;
    }
    setData(await load());
  };

  // Still waiting on the first response. Was the string "Checking…" -- one of
  // five spellings of a loading state scattered across the app, none animated.
  if (data === undefined) {
    return <Loading label="Checking extension status" />;
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
        {/* The way OUT of this state. The relevance spec is a heuristic, so it
            can be wrong; without this the card is true and unusable, and the
            move a user would guess -- connect it in the hub -- is account-wide
            and leaves the project just as irrelevant. Opting in falls straight
            through to the absent/unauthed cards, which already carry Install
            and Connect, so one click restores the whole guided chain.
            Hidden with no project: there would be nowhere to write it. */}
        {root && (
          <button
            type="button"
            className="btn primary"
            onClick={() => void optIn()}
          >
            Use {data.name} here
          </button>
        )}
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
