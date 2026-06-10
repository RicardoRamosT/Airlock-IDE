import { useApp } from "../store";

export function StatusBar() {
  const gitStatus = useApp((s) => s.gitStatus);
  const secrets = useApp((s) => s.secrets);
  const config = useApp((s) => s.config);
  const changes = gitStatus
    ? gitStatus.staged.length +
      gitStatus.unstaged.length +
      gitStatus.untracked.length
    : 0;
  return (
    <footer className="statusbar">
      <div className="statusbar-side">
        {gitStatus && (
          <span className="statusbar-item">
            <i className="codicon codicon-git-branch" />
            {gitStatus.branch.head}
            {gitStatus.branch.upstream &&
              ` ${gitStatus.branch.ahead}↑ ${gitStatus.branch.behind}↓`}
          </span>
        )}
        {gitStatus && changes > 0 && (
          <span className="statusbar-item">{changes} changes</span>
        )}
      </div>
      <div className="statusbar-side">
        {secrets.length > 0 && (
          <span className="statusbar-item">
            <i className="codicon codicon-key" />
            {secrets.length}
          </span>
        )}
        {config && (
          <span
            className="statusbar-item"
            title="Whether new terminal sessions start with this project's secrets as environment variables"
          >
            terminal secrets {config.injectSecretsIntoTerminal ? "on" : "off"}
          </span>
        )}
      </div>
    </footer>
  );
}
