import { useCallback, useEffect, useState } from "react";
import type {
  GitStatus,
  ResolvedGithubAccount,
  SecretLeak,
} from "../../../shared/ipc";
import { openFileInRoot } from "../lib/editorFiles";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

const NEW_BRANCH = "__new__";

// Which change list a row belongs to. Drives its context-menu actions (a staged
// row unstages; an untracked row's discard deletes it rather than restoring).
type Bucket = "staged" | "unstaged" | "untracked";

// One change row: a colored status letter, the FILENAME first with the
// directory dimmed + truncated (so the filename is always visible and rows are
// distinguishable), a hover-revealed stage/unstage action, and a right-click
// context menu (via onMenu) for the fuller per-file actions.
function ChangeRow({
  status,
  path,
  actionIcon,
  actionTitle,
  onAction,
  onDiff,
  onMenu,
}: {
  status: string;
  path: string;
  actionIcon: string;
  actionTitle: string;
  onAction: () => void;
  onDiff: () => void;
  onMenu: (e: React.MouseEvent) => void;
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
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click affordance for the per-file menu; the row's own controls are real buttons.
    <div className="git-row" onContextMenu={onMenu}>
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
  // Right-click change-row menu + the destructive-action confirm (discard /
  // uncommit) it can open.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    path: string;
    bucket: Bucket;
  } | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "discard"; path: string; untracked: boolean }
    | { kind: "uncommit" }
    | null
  >(null);

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

  // Dismiss the row menu / confirm on Escape.
  useEffect(() => {
    if (!menu && !confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setConfirm(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, confirm]);

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

  const openMenu = (e: React.MouseEvent, path: string, bucket: Bucket) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, path, bucket });
  };

  const copyPath = (path: string) => void navigator.clipboard?.writeText(path);

  const doDiscard = (path: string, untracked: boolean) =>
    void run(() => window.airlock.gitDiscard(root, [path], untracked));

  const doUncommit = () => void run(() => window.airlock.gitUncommit(root));

  // The last commit looks already-pushed when an upstream exists and HEAD is not
  // ahead of it; uncommitting then diverges from the remote, so the confirm warns.
  const lastCommitPushed =
    status.branch.upstream !== null && status.branch.ahead === 0;

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
              onMenu={(e) => openMenu(e, c.path, "staged")}
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
              onMenu={(e) => openMenu(e, c.path, "unstaged")}
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
              onMenu={(e) => openMenu(e, p, "untracked")}
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

      {menu && (
        <>
          <button
            type="button"
            className="popover-backdrop"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
          />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                void showDiff(
                  menu.path,
                  menu.bucket === "staged" ? "staged" : "unstaged",
                );
                setMenu(null);
              }}
            >
              <span>View diff</span>
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                void openFileInRoot(root, menu.path);
                setMenu(null);
              }}
            >
              <span>Open file</span>
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                const p = menu.path;
                void run(() =>
                  menu.bucket === "staged"
                    ? window.airlock.gitUnstage(root, [p])
                    : window.airlock.gitStage(root, [p]),
                );
                setMenu(null);
              }}
            >
              <span>{menu.bucket === "staged" ? "Unstage" : "Stage"}</span>
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                copyPath(menu.path);
                setMenu(null);
              }}
            >
              <span>Copy path</span>
            </button>
            <button
              type="button"
              className="menu-item danger"
              onClick={() => {
                setConfirm({
                  kind: "discard",
                  path: menu.path,
                  untracked: menu.bucket === "untracked",
                });
                setMenu(null);
              }}
            >
              <span>Discard changes…</span>
            </button>
            <div className="menu-sep" />
            <button
              type="button"
              className="menu-item danger"
              onClick={() => {
                setConfirm({ kind: "uncommit" });
                setMenu(null);
              }}
            >
              <span>Undo last commit…</span>
            </button>
          </div>
        </>
      )}

      {confirm && (
        <div className="modal-backdrop">
          <div className="modal">
            {confirm.kind === "discard" ? (
              <>
                <div className="modal-title">Discard changes?</div>
                <div className="modal-caption">
                  {confirm.untracked
                    ? `Delete the untracked file ${confirm.path}? This can't be undone.`
                    : `Discard all changes to ${confirm.path} and restore it to the last commit? This can't be undone.`}
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">Undo last commit?</div>
                <div className="modal-caption">
                  The commit is removed but its changes are kept (staged), so
                  you can re-commit.
                  {lastCommitPushed &&
                    " This commit appears to be pushed already — undoing it will diverge from the remote."}
                </div>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  if (confirm.kind === "discard")
                    doDiscard(confirm.path, confirm.untracked);
                  else doUncommit();
                  setConfirm(null);
                }}
              >
                {confirm.kind === "discard" ? "Discard" : "Undo commit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
