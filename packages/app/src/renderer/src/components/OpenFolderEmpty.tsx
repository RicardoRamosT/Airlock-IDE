import { openPickedFolder } from "../lib/openFolder";

// Shared no-folder empty state for every sidebar section that needs a project
// root (Files, Secrets, Databases, Git, Audit). A quiet note over a flat,
// full-width primary "Open Folder…" action (VS Code welcome-view style). The
// button opens the native folder picker and attaches the choice via
// openPickedFolder (keeps a busy blank-tab terminal alive). `message` lets a
// caller tailor the note; it defaults to the common "Open a folder first".
export function OpenFolderEmpty({
  message = "Open a folder first",
}: {
  message?: string;
}) {
  const openFolder = async () => {
    try {
      const picked = await window.airlock.openFolder();
      if (picked) await openPickedFolder(picked);
    } catch (err) {
      console.error("openFolder failed", err);
    }
  };
  return (
    <div className="open-folder-empty">
      <p className="section-note">{message}</p>
      <button type="button" className="open-folder" onClick={openFolder}>
        <i className="codicon codicon-folder-opened" />
        Open Folder…
      </button>
    </div>
  );
}
