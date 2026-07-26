import { useEffect } from "react";
import { useApp } from "../store";
import { composeSectionMeta } from "./sections";

// Keep the composed section list in step with the connected extensions.
// Mounted ONCE (App), because it owns app-global state.
//
// Only tier-2 connected extensions get a section: extensions:list builds
// manifest-integration summaries by POLLING, which is far too expensive to sit
// behind "which sections exist". Manifest integrations keep surfacing through
// their category sections until that pipeline is cheap enough.
//
// Membership follows the app-level enabled state, NOT per-project connection:
// tokens are vaulted per project, so keying it on connection would add and
// remove rail icons on every project-tab switch. Whether an extension is
// connected HERE is shown inside its section.
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
