import { useCallback, useEffect, useState } from "react";
import type {
  GitStatus,
  ResolvedGithubAccount,
  SecretLeak,
} from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

const NEW_BRANCH = "__new__";

// One change row: a colored status letter, the FILENAME first with the
// directory dimmed + truncated (so the filename is always visible and rows are
// distinguishable), and a hover-revealed stage/unstage action.
function ChangeRow({
  status,
  path,
  actionIcon,
  actionTitle,
  onAction,
  onDiff,
}: {
  status: string;
  path: string;
  actionIcon: string;
  actionTitle: string;
  onAction: () => void;
  onDiff: () => void;
}) {
  const slash = path.lastIndexOf("/");
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const ch = status.trim() || "•";
  const mod =
    ch === "?"
      ? "new"
      : ch === "A"
        ? "add"
        : ch === "D"
          ? "del"
          : ch.startsWith("R")
            ? "ren"
            : "mod";
  return (
    <div className="git-row">
      <span className={`git-letter git-letter--${mod}`}>{ch}</span>
      <button type="button" className="git-path" title={path} onClick={onDiff}>
        <span className="git-file">{base}</span>
        {dir && <span className="git-dir">{dir}</span>}
      </button>
      <button
        type="button"
        className="git-action"
        title={actionTitle}
        onClick={onAction}
      >
        <i className={`codicon codicon-${actionIcon}`} />
      </button>
    </div>
  );
}

export function GitSection() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const setDiff = useApp((s) => s.setDiff);
  const setGitStatus = useApp((s) => s.setGitStatus);
  const [isRepo, setIsRepo] = useState(false);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [leaks, setLeaks] = useState<SecretLeak[]>([]);
  const [account, setAccount] = useState<ResolvedGithubAccount | null>(null);
  const [accountList, setAccountList] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!root) return;
    try {
      const repo = await window.airlock.gitIsRepo(root);
      setIsRepo(repo);
      if (!repo) {
        setGitStatus(null, tabId);
        return;
      }
      const s = await window.airlock.gitStatus(root);
      setStatus(s);
      setGitStatus(s, tabId);
      setBranches(await window.airlock.gitBranches(root));
      setAccount(await window.airlock.resolveGithubAccount(root));
      const info = await window.airlock.githubInfo();
      setAccountList(
        info.gh.accounts
          .filter((a) => a.host === "github.com")
          .map((a) => a.username),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [root, setGitStatus, tabId]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  if (!root) return <div className="section-note">open a folder first</div>;
  if (!isRepo) return <div className="section-note">not a git repository</div>;
  if (!status) return <div className="section-note">loading…</div>;

  const run = async (op: () => Promise<unknown>) => {
    try {
      setError(null);
      await op();
      await refresh();
    } catch (err) {
      // refresh() clears the error on success, so refresh FIRST then set the
      // error last -- otherwise the message flashes for a frame and vanishes.
      await refresh();
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sync = (op: () => Promise<unknown>) => {
    setSyncing(true);
    void run(op).finally(() => setSyncing(false));
  };

  const showDiff = async (path: string, which: "staged" | "unstaged") => {
    try {
      const v = await window.airlock.gitFileVersions(root, path, which);
      if (v.binary) {
        setError(`${path}: binary file, no diff`);
        return;
      }
      if (v.truncated) {
        setError(`${path}: file exceeds 1 MB, diff unavailable`);
        return;
      }
      setDiff(
        { path, which, original: v.original, modified: v.modified },
        tabId,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const switchTo = (value: string) => {
    if (value === NEW_BRANCH) {
      setNewBranch("");
      return;
    }
    if (value !== status.branch.head)
      void run(() => window.airlock.gitSwitchBranch(root, value));
  };

  return (
    <div className="git">
      <div className="git-branch-row">
        <i className="codicon codicon-git-branch" />
        <select
          className="sb-control"
          value={status.branch.head}
          onChange={(e) => switchTo(e.target.value)}
        >
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          <option value={NEW_BRANCH}>+ new branch…</option>
        </select>
        {status.branch.upstream &&
          (status.branch.ahead > 0 || status.branch.behind > 0) && (
            <span className="git-sync">
              {status.branch.ahead > 0 && (
                <span className="git-ahead">↑{status.branch.ahead}</span>
              )}
              {status.branch.behind > 0 && (
                <span className="git-behind">↓{status.branch.behind}</span>
              )}
            </span>
          )}
      </div>
      {account && (
        <div className="git-account-row" title={`source: ${account.source}`}>
          <i className="codicon codicon-github" />
          {account.protocol === "ssh" ? (
            <span className="section-note">
              push as: SSH remote — uses your keys
            </span>
          ) : (
            <>
              <span className="git-account-label">push as</span>
              <select
                className="sb-control"
                value={
                  account.source === "override" && account.account
                    ? account.account.username
                    : "__auto__"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  void run(() =>
                    window.airlock.setProjectGithubAccount(
                      root,
                      v === "__auto__"
                        ? null
                        : { host: "github.com", username: v },
                    ),
                  );
                }}
              >
                <option value="__auto__">
                  Auto
                  {account.source !== "override" && account.account
                    ? ` (${account.account.username})`
                    : account.source === "none"
                      ? " (none — pick one)"
                      : ""}
                </option>
                {accountList.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}
      <div className="section-toolbar">
        <button
          type="button"
          className="btn"
          title="Fetch"
          disabled={syncing}
          onClick={() => sync(() => window.airlock.gitFetch(root))}
        >
          Fetch
        </button>
        <button
          type="button"
          className="btn"
          title="Pull (fast-forward only)"
          disabled={syncing}
          onClick={() => sync(() => window.airlock.gitPull(root))}
        >
          Pull{status.branch.behind > 0 ? ` ${status.branch.behind}` : ""}
        </button>
        <button
          type="button"
          className="btn"
          title={status.branch.upstream ? "Push" : "Publish branch"}
          disabled={syncing}
          onClick={() => sync(() => window.airlock.gitPush(root))}
        >
          {status.branch.upstream
            ? `Push${status.branch.ahead > 0 ? ` ${status.branch.ahead}` : ""}`
            : "Publish"}
        </button>
      </div>
      {newBranch !== null && (
        <form
          className="git-new-branch"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newBranch.trim();
            setNewBranch(null);
            if (name)
              void run(() => window.airlock.gitCreateBranch(root, name));
          }}
        >
          <input
            className="modal-input"
            placeholder="new-branch-name"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            spellCheck={false}
          />
        </form>
      )}

      {status.staged.length > 0 && (
        <div className="git-group">
          <div className="git-group-title">staged</div>
          {status.staged.map((c) => (
            <ChangeRow
              key={`s-${c.path}`}
              status={c.index}
              path={c.path}
              actionIcon="remove"
              actionTitle="Unstage"
              onAction={() =>
                void run(() => window.airlock.gitUnstage(root, [c.path]))
              }
              onDiff={() => void showDiff(c.path, "staged")}
            />
          ))}
        </div>
      )}

      {(status.unstaged.length > 0 || status.untracked.length > 0) && (
        <div className="git-group">
          <div className="git-group-title">changes</div>
          {status.unstaged.map((c) => (
            <ChangeRow
              key={`u-${c.path}`}
              status={c.worktree}
              path={c.path}
              actionIcon="add"
              actionTitle="Stage"
              onAction={() =>
                void run(() => window.airlock.gitStage(root, [c.path]))
              }
              onDiff={() => void showDiff(c.path, "unstaged")}
            />
          ))}
          {status.untracked.map((p) => (
            <ChangeRow
              key={`n-${p}`}
              status="?"
              path={p}
              actionIcon="add"
              actionTitle="Stage"
              onAction={() =>
                void run(() => window.airlock.gitStage(root, [p]))
              }
              onDiff={() => void showDiff(p, "unstaged")}
            />
          ))}
        </div>
      )}

      <textarea
        className="modal-input git-message"
        placeholder="commit message"
        rows={2}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        spellCheck={false}
      />
      <button
        type="button"
        className="btn primary"
        disabled={status.staged.length === 0 || message.trim() === ""}
        onClick={() =>
          void run(async () => {
            const outcome = await window.airlock.gitCommit(root, message);
            setLeaks(outcome.leaks);
            setMessage("");
          })
        }
      >
        Commit {status.staged.length > 0 ? `(${status.staged.length})` : ""}
      </button>
      {leaks.length > 0 && (
        <div className="git-leak-warning" role="status">
          {leaks.length} location(s) contain secret values:
          <ul>
            {leaks.map((l) => (
              <li key={`${l.path}:${l.line}:${l.name ?? l.patternType}`}>
                {l.name ?? l.patternType} in {l.path}:{l.line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="modal-error">{error}</div>}
    </div>
  );
}
