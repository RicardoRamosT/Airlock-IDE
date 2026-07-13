import { useEffect, useState } from "react";
import type { IntegrationItem } from "../../../shared/ipc";
import { useApp } from "../store";
import { useProjectTab } from "./projectPane";

// Poll the eye-on connected extensions' resources (extensions:resources) and
// return the ones targeting `category`, flattened. Used by the Git and Activity
// sections to render surfaced GitHub / Slack rows. Resets on project switch so a
// previous project's rows never linger; the 5s poll matches the other sections.
export function useExtensionResources(category: string): IntegrationItem[] {
  const [rows, setRows] = useState<IntegrationItem[]>([]);
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: root is a trigger dep — reset + reload on project switch (extensions:resources is root-scoped main-side).
  useEffect(() => {
    let cancelled = false;
    setRows([]);
    const load = () =>
      void window.airlock
        .extensionsResources()
        .then((all) => {
          if (cancelled) return;
          setRows(
            all
              .filter((r) => r.category === category)
              .flatMap((r) => r.resources),
          );
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [category, root]);

  return rows;
}
