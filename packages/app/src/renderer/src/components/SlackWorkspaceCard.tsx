import { useApp } from "../store";

// Which workspace the vaulted token belongs to, and the way to change it.
// Switching opens the existing connect modal; the connect flow already resets
// the allow-list when the workspace changes (slackWorkspacePatch), so nothing
// here has to.
export function SlackWorkspaceCard({
  workspace,
}: {
  workspace?: { id: string; name: string };
}) {
  return (
    <div className="sb-card slack-workspace">
      {workspace ? (
        <div className="slack-workspace-name" title={workspace.id}>
          <i className="codicon codicon-organization" aria-hidden="true" />
          <span>{workspace.name}</span>
        </div>
      ) : (
        // Never a guessed name: a confidently wrong workspace is what made
        // "Claude can't see any messages" so hard to diagnose.
        <div className="section-note">
          Workspace unknown — reconnect to identify it
        </div>
      )}
      <button
        type="button"
        className="btn"
        onClick={() => useApp.getState().setModal("connect-slack")}
      >
        Switch workspace
      </button>
    </div>
  );
}
