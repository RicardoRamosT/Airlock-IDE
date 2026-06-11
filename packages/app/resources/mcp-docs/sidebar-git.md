# Sidebar · Git

## What it shows
The working-tree status for the open folder when it is a git repo: changed/staged/unstaged
files, the current branch, a branch switcher and "new branch" control, a commit message
box, and per-file diffs (clicking a file opens its diff in the main area). If the folder is
not a git repo, the section says so.

The MCP tool `git_status` returns the same working-tree status (branch, staged/unstaged
changes) for the workspace, and `git_commit` commits what is staged (after a secret-leak
scan of the staged content — see `tools.md`).

## When it's useful
Useful for any project under version control — which is most of them. Signal: a `.git`
directory exists (equivalently, `git_status` succeeds rather than reporting "not a repo").
Keep Git visible for any repo; the human leans on it to stage, diff, and commit alongside
your terminal work. Hide it only for a scratch folder that is deliberately not a repo, or
where the human has said they don't want git surfaced.
