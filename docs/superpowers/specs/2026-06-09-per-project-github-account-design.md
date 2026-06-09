# Per-project GitHub account — design

Date: 2026-06-09
Status: design (pending implementation plan)

## Goal

Let each open project use a **different GitHub account** for its Git remote
operations (push / pull / fetch) **and** its commit authorship, **concurrently**
— so working across projects owned by different accounts never requires
`gh auth switch`-ing back and forth. Account selection is **auto-detected** from
the repo, with a manual override.

## Non-goals (YAGNI / deferred)

- Terminal `git`/`gh` injection (commands the user runs in a project's terminal
  still use the machine-global active account). Future phase.
- SSH remotes (token injection only applies to HTTPS; SSH falls back to the
  user's keys — surfaced, not broken).
- `gh pr` / PR-creation auth (AirLock has no PR-create flow yet).
- Changing the machine-global active account behavior — the existing global
  Accounts popover stays as the default for everything outside AirLock's
  Git-panel operations.

## Background (current state)

- `runGit(root, args)` (`agent-core/src/git/run.ts`) shells out to `git` via
  `execFile` (no shell), cwd = project root, **no custom env**. Auth flows
  through the user's configured credential helper — i.e. gh's helper, which uses
  the **globally active** account.
- `gitFetch/gitPull/gitPush` (`git/ops.ts`) call `runGit` directly.
- `ghAccounts()` / `switchGhAccount()` (`github/accounts.ts`) list and switch the
  **global** active account.
- Per-project config lives in `.airlock/config.json`
  (`project/config.ts`, `ProjectConfig`).
- gh 2.87.3 supports `gh auth token --user <name> --hostname <host>` — emits a
  token for a **specific, non-active** account without switching. This is the
  enabler.

## Mechanism: per-op token injection

Resolve a project's account → fetch that account's token → inject it into the
single `git` invocation, with the token passed via the child **environment**
(never argv), using an inline credential helper:

```
git -c credential.helper= \
    -c credential.helper='!f() { test "$1" = get && \
        printf "username=x-access-token\npassword=%s\n" "$AIRLOCK_GH_TOKEN"; }; f' \
    <fetch|pull|push args>
```

- The empty first `credential.helper=` clears the inherited helper list so gh's
  global helper does NOT also fire; only our token applies.
- `AIRLOCK_GH_TOKEN` is set in the child env, so the secret never appears in argv
  (not visible via `ps`).
- No global state mutated → project A (account X) and project B (account Y) push
  at the same time with no interference. Concurrency-safe by construction.
- HTTPS only. For an SSH `origin`, credential helpers don't apply; we skip
  injection and run the op as today (the UI flags "uses your SSH keys").

## Account resolution

For a project root, resolve in this precedence (`resolveProjectAccount`):

1. **Override**: `.airlock/config.json` `githubAccount` `{host, username}`, if set
   and still a logged-in account.
2. **Auto-detect**: parse `origin`'s URL → `{host, owner, protocol}`. If a
   logged-in gh account's `username === owner`, use it
   (e.g. `github.com/RicardoRamosT/repo` → `RicardoRamosT`).
3. **No match** (typical for org repos, e.g. `github.com/ViewNear/repo`): resolve
   to `none`. Remote ops fall back to current behavior (global active account),
   and the UI prompts the user to pick an account once.

Only the **override** is persisted. Auto-detect recomputes each call, so renaming
or re-pointing `origin` just works. Result shape returned to the UI:
`{ account: {host, username} | null, source: "override" | "auto" | "none",
   protocol: "https" | "ssh" | "unknown" }`.

## Commit identity (v1)

When a project resolves to account X, commits in that repo are authored as X:

- `ghUserIdentity(host, username, token)` → `{ name, email }` via
  `GH_TOKEN=<token> gh api user --hostname <host>` (returns `login`, `id`,
  `name`, `email`). `name` falls back to `login`; `email` falls back to the
  GitHub no-reply form `<id>+<login>@users.noreply.github.com` when the account's
  email is private/null. Memoized per `(host, username)` in main (identity rarely
  changes).
- `ensureCommitIdentity(root, {name, email})` reads the repo's local
  `user.name`/`user.email` and writes them (`git config --local`) only when they
  differ — idempotent, no needless writes.
- Applied (a) immediately when the user picks/overrides an account, and (b)
  **before each commit** (covers auto-detected accounts too), so authorship is
  always correct without writing config on passive UI resolution.

## Architecture / components

**agent-core:**
- `github/accounts.ts`: add `ghToken(host, username, run)` →
  `gh auth token --user --hostname`; add `ghUserIdentity(host, username, token, run)`
  → parse `gh api user`. Validate host/username (existing regex pattern).
- `git/remote.ts` (new, pure): `parseRemote(url)` →
  `{host, owner, repo, protocol}`; `getOrigin(root)` via `runGit`.
- `git/auth.ts` (new): `runGitAuthed(root, token, args)` — builds the
  credential-helper `-c` flags + env and calls the same `execFile` path as
  `runGit` (token in env). When `token` is null, delegates to plain `runGit`.
- `git/identity.ts` (new, pure-ish): `ensureCommitIdentity(root, identity)`.
- `git/ops.ts`: `gitFetch/gitPull/gitPush` accept an optional `token` and route
  network ops through `runGitAuthed`.

**Resolution (main-side, needs gh accounts + config):**
- `git/resolve.ts` or in main: `resolveProjectAccount(root)` implementing the
  precedence above (pure given injected gh-accounts + config + origin).

**project/config.ts:** add optional
`githubAccount?: { host: string; username: string }` to `ProjectConfig`.

**main/ipc.ts:**
- Route `git:fetch/pull/push` and `git:commit` through resolution → token /
  identity → ops.
- New handlers: `github:resolveAccount(root)` (for the UI readout) and
  `github:setProjectAccount(root, account|null)` (persist override; `null` clears
  to auto). Applying identity on explicit pick happens here.

**shared/ipc.ts:** `ResolvedGithubAccount` type;
`resolveGithubAccount(root)` + `setProjectGithubAccount(root, acct|null)` on
`AirlockApi`.

**renderer:** `GitSection.tsx` gains a readout `Push as: <username> (auto|set) ▾`
with a dropdown listing logged-in accounts + "Auto"; selecting persists the
override and refreshes. The global Accounts popover is unchanged.

## Data flow (push)

```
GitSection push ─▶ main git:push(root)
  resolveProjectAccount(root)  (override | auto-from-origin | none)
   └ account ─▶ ghToken(host, user) ─▶ token
                ensureCommitIdentity(root, ghUserIdentity(...))   [also pre-commit]
                gitPush(root, token) ─▶ runGitAuthed (token in env, inline helper)
  account=none ─▶ gitPush(root, null) ─▶ runGit (today's behavior)
```

## Edge cases / errors (expected, surfaced — not crashes)

- **SSH origin** → skip token injection; readout shows "SSH remote — uses your
  keys"; override picker disabled with that note.
- **No `origin`** → `none`; ops behave as today; readout hidden or "no remote".
- **Org repo / no username match** → `none` + "pick an account" prompt; override
  persists the choice.
- **`gh auth token --user X` fails** (logged out / no such account) → op fails
  with a clear message; readout flags the account as unavailable.
- **Token lacks scope / no repo access** → git's auth error surfaces verbatim.
- **`gh api user` fails** (offline) → identity not updated this time (best
  effort); auth still proceeds.

## Security / ethos

- Tokens are fetched and used **main-side only**, passed to git via env, never
  returned to the renderer or exposed to the agent — consistent with the
  no-secret-value IPC invariant and the secret-broker model.
- No token is written to disk (rejected approach C). The override stores only a
  `{host, username}` reference, never a credential.
- Empty-helper-first prevents the global gh helper from leaking a different
  account into the op.

## Testing (pure modules unit-tested; electron/exec wiring kept thin)

- `parseRemote`: https / ssh / `git@` / org / trailing-`.git` / non-GitHub.
- `resolveProjectAccount`: override > auto > none; protocol detection; override
  pointing at a logged-out account → falls through.
- `runGitAuthed`: constructs the expected `-c` flags and puts the token in
  **env not argv** (assert via an injected fake exec); null token → plain runGit.
- `ghToken` / `ghUserIdentity`: argv construction + output parsing (injected
  runner); identity name/email fallbacks (private email → noreply).
- `ensureCommitIdentity`: writes only when differing; idempotent.
- `ProjectConfig`: `githubAccount` round-trips; absent → undefined.

## Decisions to confirm at spec review

1. Auto-detect matches `origin` owner to a logged-in **username** only (org repos
   need a manual pick). Acceptable for v1?
2. Commit identity is ensured before each commit + on explicit pick (not on
   passive UI resolution), to avoid surprising `git config` writes.
