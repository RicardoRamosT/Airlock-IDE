import { useCallback, useEffect, useState } from "react";
import type { GitStatus } from "../../../shared/ipc";
import { useApp } from "../store";

const NEW_BRANCH = "__new__";

export function GitSection() {
  const root = useApp((s) => s.root);
  const setDiff = useApp((s) => s.setDiff);
  const [isRepo, setIsRepo] = useState(false);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!root) return;
    try {
      const repo = await window.airlock.gitIsRepo();
      setIsRepo(repo);
      if (!repo) return;
      setStatus(await window.airlock.gitStatus());
      setBranches(await window.airlock.gitBranches());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [root]);

  useEffect(() => {
    refresh().catch(console.error);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
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
      setError(err instanceof Error ? err.message : String(err));
      await refresh();
    }
  };

  const showDiff = async (path: string, which: "staged" | "unstaged") => {
    try {
      const v = await window.airlock.gitFileVersions(path, which);
      if (v.binary) {
        setError(`${path}: binary file, no diff`);
        return;
      }
      if (v.truncated) {
        setError(`${path}: file exceeds 1 MB, diff unavailable`);
        return;
      }
      setDiff({ path, which, original: v.original, modified: v.modified });
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
      void run(() => window.airlock.gitSwitchBranch(value));
  };

  return (
    <div className="git">
      <div className="git-branch-row">
        <i className="codicon codicon-git-branch" />
        <select
          className="git-branch"
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
        {status.branch.upstream && (
          <span className="badge dim-badge">
            ↑{status.branch.ahead} ↓{status.branch.behind}
          </span>
        )}
      </div>
      {newBranch !== null && (
        <form
          className="git-new-branch"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newBranch.trim();
            setNewBranch(null);
            if (name) void run(() => window.airlock.gitCreateBranch(name));
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
            <div key={`s-${c.path}`} className="git-row">
              <span className="git-letter">{c.index}</span>
              <button
                type="button"
                className="git-path"
                title="Show staged diff"
                onClick={() => void showDiff(c.path, "staged")}
              >
                {c.path}
              </button>
              <button
                type="button"
                className="git-action"
                title="Unstage"
                onClick={() =>
                  void run(() => window.airlock.gitUnstage([c.path]))
                }
              >
                <i className="codicon codicon-remove" />
              </button>
            </div>
          ))}
        </div>
      )}

      {(status.unstaged.length > 0 || status.untracked.length > 0) && (
        <div className="git-group">
          <div className="git-group-title">changes</div>
          {status.unstaged.map((c) => (
            <div key={`u-${c.path}`} className="git-row">
              <span className="git-letter">{c.worktree}</span>
              <button
                type="button"
                className="git-path"
                title="Show diff"
                onClick={() => void showDiff(c.path, "unstaged")}
              >
                {c.path}
              </button>
              <button
                type="button"
                className="git-action"
                title="Stage"
                onClick={() =>
                  void run(() => window.airlock.gitStage([c.path]))
                }
              >
                <i className="codicon codicon-add" />
              </button>
            </div>
          ))}
          {status.untracked.map((p) => (
            <div key={`n-${p}`} className="git-row">
              <span className="git-letter">?</span>
              <button
                type="button"
                className="git-path"
                title="Show new file"
                onClick={() => void showDiff(p, "unstaged")}
              >
                {p}
              </button>
              <button
                type="button"
                className="git-action"
                title="Stage"
                onClick={() => void run(() => window.airlock.gitStage([p]))}
              >
                <i className="codicon codicon-add" />
              </button>
            </div>
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
            await window.airlock.gitCommit(message);
            setMessage("");
          })
        }
      >
        Commit {status.staged.length > 0 ? `(${status.staged.length})` : ""}
      </button>
      {error && <div className="modal-error">{error}</div>}
    </div>
  );
}
