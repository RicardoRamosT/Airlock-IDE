import { useEffect } from "react";
import { useApp } from "../store";
import { composeSectionMeta } from "./sections";

// Keep the composed section list in step with the connected extensions.
// Mounted ONCE (App), because it owns app-global state.
//
// Manifest ("status" tier) integrations do NOT get their own rail section:
// extensions:list builds those summaries by POLLING, which is far too
// expensive to sit behind "which sections exist". They keep surfacing through
// their category sections (Host, Databases, ...) until that pipeline is cheap
// enough. Connected and section-tier extensions are never polled, so both get
// a dedicated rail icon -- but the two gate differently:
//
// - Connected extensions follow the app-level enabled state, NOT per-project
//   connection: tokens are vaulted per project, so keying it on connection
//   would add and remove rail icons on every project-tab switch. Whether an
//   extension is connected HERE is shown inside its section.
// - Section extensions are added UNCONDITIONALLY, enabled or not: a user
//   cannot enable what they cannot see. Right-click -> Hide is the escape
//   valve for a rail that gets too long.
export function useSyncSectionMeta(): void {
  const setSectionMeta = useApp((s) => s.setSectionMeta);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void window.airlock
        .extensionsList()
        .then((all) => {
          if (cancelled) return;
          setSectionMeta(
            composeSectionMeta(
              all
                .filter((e) => e.tier === "connected" && e.enabled)
                .map((e) => ({ id: e.id, name: e.name, icon: e.icon })),
              // Section extensions are shown ALWAYS, enabled or not: a user
              // cannot enable what they cannot see. Right-click -> Hide is the
              // escape valve.
              all
                .filter((e) => e.tier === "section")
                .map((e) => ({ id: e.id, name: e.name, icon: e.icon })),
            ),
          );
        })
        .catch(() => {});
    load();
    // Connecting or disabling an extension changes the rail; refresh on focus
    // so the change lands without a relaunch.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [setSectionMeta]);
}
