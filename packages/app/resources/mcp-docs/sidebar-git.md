# Sidebar · Git

## What it shows
The working-tree status for the open folder when it is a git repo: changed/staged/unstaged
files, the current branch, a branch switcher and "new branch" control, a commit message
box, and per-file diffs (clicking a file opens its diff in the main area). If the folder is
not a git repo, the section says so.

The MCP tool `git_status` returns the same working-tree status (branch, staged/unstaged
changes) for the workspace, and `git_commit` commits what is staged (after a secret-leak
scan of the staged content — see `tools.md`).

## CI for the current branch

Beside the branch switcher, the Git section shows the latest GitHub Actions run for
the branch the human is on: workflow name, state, per-step count, and a link to the
run. It arrived here when the Activity panel was deleted -- it was the only thing
that panel uniquely knew. The row is ABSENT when there is nothing to report (no
repo, no `gh`, no workflow, detached HEAD), so an empty Git section means no CI
rather than a broken probe.

You can read the same data with the `ci_status` tool; both go through one
implementation, so what you see and what the human sees cannot disagree.

## When it's useful
Useful for any project under version control — which is most of them. Signal: a `.git`
directory exists (equivalently, `git_status` succeeds rather than reporting "not a repo").
Keep Git visible for any repo; the human leans on it to stage, diff, and commit alongside
your terminal work. Hide it only for a scratch folder that is deliberately not a repo, or
where the human has said they don't want git surfaced.
