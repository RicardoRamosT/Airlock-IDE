import { useEffect, useState } from "react";
import type { IntegrationItem } from "../../../shared/ipc";
import { ResourceRow } from "./ResourceRow";

// The expanded body under an expandable extension: fetches that integration's
// resources on demand and renders them with the shared ResourceRow. The source
// depends on the tier -- Tier-2 connected extensions (Slack/GitHub) are
// root-scoped via extensions:resourcesFor; Tier-1 steady CLI integrations
// (Azure/Snowflake) are account-wide via integrations:resources. Polls while
// mounted, stops on unmount. `items === null` = still loading.
//
// Lifted out of ExtensionsSection.tsx (the sidebar hub) so the Extensions PAGE
// can render the same resource list for its selected row -- the sidebar is
// deleted once the page reaches parity, and this component must survive that.
export function ExtensionResources({
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
        {/* "when pinned" used to qualify the connected case. It was already
            false: the routers show every provider row unconditionally, and the
            pin that once gated them reads nothing any more. */}
        {connected
          ? `Also shown in the ${viewLabel} section.`
          : `Also shown in the ${viewLabel} view for projects that use ${name}.`}
      </div>
    </div>
  );
}
