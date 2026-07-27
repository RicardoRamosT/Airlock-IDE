import { useApp } from "../store";

// Which workspace the vaulted token belongs to, and the way to change it.
//
// Switching opens the OAuth browser flow in MANAGE mode -- the same modal the
// Extensions hub's "Change workspace" uses. NOT the paste-a-token modal: asking
// someone for a xoxb-/xoxp- token means sending them to api.slack.com to mint
// one, which no ordinary user will do. The connect flow already resets the
// allow-list when the workspace actually changes (slackWorkspacePatch), so
// nothing here has to.
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
        onClick={() =>
          useApp.getState().setModal({
            oauthDevice: { id: "slack", name: "Slack", manage: true },
          })
        }
      >
        Switch workspace
      </button>
    </div>
  );
}
