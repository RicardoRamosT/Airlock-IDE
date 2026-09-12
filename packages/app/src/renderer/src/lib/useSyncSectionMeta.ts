import { useEffect } from "react";
import { useApp } from "../store";
import { isRelevantHere, relevantIds } from "./extensionRelevance";
import { composeSectionMeta } from "./sections";

// Keep the composed section list in step with the connected extensions.
// Mounted ONCE (App), because it owns app-global state.
//
// Manifest ("status" tier) integrations do NOT get their own rail section:
// extensions:list builds those summaries by POLLING, which is far too
// expensive to sit behind "which sections exist". They keep surfacing through
// their category sections (Host, Databases, ...) until that pipeline is cheap
// enough. Connected and section extensions are never polled, so both get a
// dedicated rail icon -- but the two gate differently:
//
// - Connected extensions follow the app-level enabled state, NOT per-project
//   connection: tokens are vaulted per project, so keying it on connection
//   would add and remove rail icons on every project-tab switch. Whether an
//   extension is connected HERE is shown inside its section.
// - BOTH are now filtered by per-project RELEVANCE. The sidebar shows what
//   this project uses: an extension whose signal does not fire here, and that
//   you have not turned on here, is not listed. `projectUse` is computed
//   main-side, so the rail and the Databases/Host provider rows cannot answer
//   "does this project use X?" differently.
//
//   This reverses the old "section extensions are added unconditionally --
//   a user cannot enable what they cannot see" rule. That rule's job is now
//   done by the Extensions hub, which is always on the rail and lists every
//   extension whether it is relevant, connected or installed. Right-click ->
//   Hide remains the manual escape valve, and "Use it here" is the override
//   for a signal that guessed wrong.
//
// Section extensions are selected by `hasSection`, NOT `tier === "section"`
// (changed 2026-07-27, the duplicate-row fix): Snowflake/Azure/Vercel are each
// BOTH a real manifest and a SECTION_EXTENSIONS descriptor, and
// mergeSectionExtensions (agent-core) lets the manifest row win for the hub
// list -- so an overlapping id arrives here as `tier: "status"` carrying a
// REAL detect status, not `tier: "section"`. Keying this filter on tier alone
// would silently drop its rail icon the moment its manifest data won out.
// `hasSection` is the flag mergeSectionExtensions sets on exactly the ids that
// should always have a rail icon, independent of which tier its status rides
// in on.
export function useSyncSectionMeta(): void {
  const setSectionMeta = useApp((s) => s.setSectionMeta);
  const setRelevantExtensions = useApp((s) => s.setRelevantExtensions);
  // Relevance is per-project, so the rail has to be recomputed when the
  // focused project changes -- not just on mount and window focus.
  const root = useApp((s) => s.root);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void window.airlock
        .extensionsList(root)
        .then((all) => {
          if (cancelled) return;
          // One answer, shared: the rail filters on it here and the
          // Databases/Host provider rows read the same ids from the store.
          //
          // With NO project focused there is no answer to give -- null, not a
          // list -- so every surface falls back to showing everything rather
          // than to showing nothing.
          setRelevantExtensions(root ? relevantIds(all) : null);
          setSectionMeta(
            composeSectionMeta(
              all
                .filter(
                  (e) =>
                    e.tier === "connected" && e.enabled && isRelevantHere(e),
                )
                .map((e) => ({ id: e.id, name: e.name, icon: e.icon })),
              all
                .filter((e) => e.hasSection === true && isRelevantHere(e))
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
  }, [setSectionMeta, setRelevantExtensions, root]);
}
