import { useApp } from "../store";

export function TitleBar() {
  const root = useApp((s) => s.root);
  const project = root ? (root.split("/").pop() ?? "") : "";
  return (
    <header className="titlebar">
      <span className="titlebar-title">
        {project ? `airlock — ${project}` : "airlock"}
      </span>
    </header>
  );
}
