# Git Sync Buttons -- Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Phase:** 1 (Navigable), sub-project 3 of 3 (palette -> search -> **git-sync**) -- the last Phase 1 piece.

## Goal

Fetch / pull / push from the Git sidebar so the user stops dropping to the
terminal to sync. The ahead/behind indicator already exists; add the actions.

## Background (already in place)

- `runGit(root, args)` (`agent-core/git/run.ts`) shells out to `git` with an argv
  array (no shell), throwing an Error carrying git's stderr on nonzero exit.
- `GitStatus.branch` already has `head`, `upstream: string | null`, `ahead`,
  `behind` (parsed from `status --porcelain=v2 --branch`). `GitSection` already
  renders `↑{ahead} ↓{behind}`.

So this feature is small: add three `ops` functions, three IPCs, and a button row.

## Decisions (technical calls delegated to the implementer)

1. **Three explicit buttons** (Fetch / Pull / Push), not a combined "Sync" --
   each maps to one git action.
2. **`pull --ff-only`** -- a plain `git pull` on a diverged branch opens an editor
   for the merge message, which HANGS in our no-TTY child process. `--ff-only`
   fast-forwards or fails with a clear message; a real divergence is resolved in
   the terminal. (Safe + predictable.)
3. **Push auto-publishes** the first time: no upstream -> `git push -u origin
   <branch>`; otherwise `git push`.
4. Reuse the existing credential path -- shelling out to `git` uses the user's
   configured credential helper / SSH keys, exactly like the terminal.

## Non-goals (YAGNI)

- Combined one-click "Sync" (pull+push).
- Force-push, push to a non-default remote, choosing a remote/branch.
- In-app merge-conflict resolution or interactive merge (terminal handles it).
- A plain (merge) pull; we use `--ff-only`.

## Architecture and components

### agent-core (`git/ops.ts`)

```ts
export async function gitFetch(root: string): Promise<void> {
  await runGit(root, ["fetch"]);
}

export async function gitPull(root: string): Promise<void> {
  await runGit(root, ["pull", "--ff-only"]);
}

export async function gitPush(root: string): Promise<void> {
  let hasUpstream = true;
  try {
    await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  } catch {
    hasUpstream = false;
  }
  if (hasUpstream) {
    await runGit(root, ["push"]);
    return;
  }
  const branch = (await runGit(root, ["symbolic-ref", "--short", "HEAD"])).trim();
  await runGit(root, ["push", "-u", "origin", branch]);
}
```

(Names `gitFetch`/`gitPull`/`gitPush` to avoid colliding with any built-in
`fetch`. Exported from the package index.)

### IPC (main + preload + shared)

- `shared/ipc.ts`: add to `AirlockApi` -- `gitFetch(root)`, `gitPull(root)`,
  `gitPush(root)`, each `Promise<void>`.
- `preload/index.ts`: wire `git:fetch` / `git:pull` / `git:push`.
- `main/ipc.ts`: three handlers calling the ops with `resolveRoot(e, root)`
  (alongside the other `git:*` handlers).

### renderer (`components/GitSection.tsx`)

- A sync row near the branch/ahead-behind line: **Fetch**, **Pull**, **Push**
  buttons. The Push button reads **"Publish"** when `status.branch.upstream ===
  null`. Pull/Push may show their counts (`Pull {behind}` / `Push {ahead}`) using
  the existing `ahead`/`behind`.
- A local `busy` state disables the buttons during an op; an `error` string shows
  git's stderr inline on failure (cleared on the next action).
- After any op resolves, re-fetch `gitStatus` (reuse the section's existing status
  load) so the counts/branch update.

### Data flow

Click Fetch/Pull/Push -> `window.airlock.git{Fetch,Pull,Push}(root)` -> ops ->
`runGit` -> on success re-fetch `gitStatus`; on throw, show the stderr message.

## Error handling

- `runGit` throws git's stderr -> the IPC rejects -> `GitSection` shows it inline
  (e.g. "Updates were rejected...", "fatal: could not read Username", "Not
  possible to fast-forward"). Never crashes.
- All three are no-TTY safe (`--ff-only`, plain `push`/`fetch` never prompt an
  editor; credential prompts go through the configured helper, not a TTY).

## Testing

- `ops.test.ts` (agent-core, real git -- matches the existing git tests): set up
  a **bare repo as origin** + a working clone; assert `gitPush` publishes (sets
  upstream) on first push, `gitFetch` updates remote-tracking refs, and
  `gitPull --ff-only` fast-forwards a clone behind origin. (These use real `git`
  in a tmp dir, like `ops.test.ts`/`status.test.ts` already do.)
- `GitSection` jsdom test: clicking Push calls `window.airlock.gitPush(root)`; a
  rejected promise shows the error text; the Push button reads "Publish" when
  `upstream` is null.

## Constraints

- ASCII-only in `agent-core/git/ops.ts`, `main/ipc.ts`, `shared/ipc.ts`,
  `preload/index.ts` (CJS bundling -- use `--`).
- Renderer `.tsx`/`.css` and this doc are exempt.
