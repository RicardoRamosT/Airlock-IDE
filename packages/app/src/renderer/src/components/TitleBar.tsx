import { useApp } from "../store";
import { LayoutControls } from "./LayoutControls";

export function TitleBar() {
  const root = useApp((s) => s.root);
  const project = root ? (root.split("/").pop() ?? "") : "";
  return (
    <header className="titlebar">
      <span className="titlebar-title">
        {project ? `AirLock - ${project}` : "AirLock"}
      </span>
      <LayoutControls />
    </header>
  );
}
