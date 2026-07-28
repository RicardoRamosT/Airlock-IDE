import { useEffect, useState } from "react";
import type { IntegrationItem } from "../../../shared/ipc";
import { Loading } from "./Loading";
import { ResourceRow } from "./ResourceRow";
// The DEFAULT sidebar view for an extension: its granted resources as rows.
// Any extension gets a usable section from this without custom code; only an
// extension whose data is not a plain resource list (Slack's chat) registers a
// bespoke view in lib/extensionViews.ts.
export function ExtensionResourcesSection({ extId }: { extId: string }) {
  const [rows, setRows] = useState<IntegrationItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void window.airlock
      .extensionsResourcesFor(extId)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        // A failed fetch degrades to the empty note -- never a blank panel with
        // no explanation of why nothing is here.
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [extId]);

  if (rows === null) return <Loading label="Loading resources" />;
  if (rows.length === 0)
    return <div className="section-note">Nothing to show yet.</div>;
  return (
    <>
      {rows.map((r) => (
        <ResourceRow key={r.id} r={r} />
      ))}
    </>
  );
}
