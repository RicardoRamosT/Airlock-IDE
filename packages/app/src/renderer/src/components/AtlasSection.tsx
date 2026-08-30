import { AtlasPanel } from "./AtlasPanel";

// Atlas in the sidebar -- the default surface. Hosts the shared panel so it
// cannot drift from the dropdown and the window.
export function AtlasSection() {
  return (
    <div className="atlas-pane">
      <AtlasPanel />
    </div>
  );
}
