# Secret-Leak Detection -- Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Phase:** 3 (Safety moat), **sub-project 1 of 3** (secret-leak detection ->
dependency scanning -> agent sandboxing).

## Goal

Detect when a secret VALUE (one you've vaulted) or a known secret PATTERN appears
in content that is about to be persisted or committed, and surface it -- as a
quiet advisory to the human and as an explicit confirmation gate to the AI agent
before it commits -- **without ever revealing the value**. This extends the
broker + redactor to the persisted surfaces (git commit) that the agent-visible
surfaces (run_command / terminal tail) already cover.

## Decisions

1. **Interaction model.** The HUMAN is never blocked: a quiet, non-modal
   indicator only. The AGENT is informed (`git_status` carries leak info) and its
   commit path goes through a `git_commit` MCP tool that refuses a suspected-leak
   commit unless re-called with `confirm: true`. The safety decision rides on the
   agent, which surfaces it back to the user in chat rather than via an IDE modal.
2. **Detect BOTH** vaulted values (literal + encoded forms; the finding names the
   secret) AND known secret patterns (unanchored provider shapes; type only,
   catches secrets that were never vaulted).
3. **Secret-blind invariant preserved.** Findings carry `name` / `patternType` +
   `path:line` only, NEVER the value. The scan orchestrator that pulls values
   lives OUTSIDE `tools.ts`; the existing CI guard (which asserts `tools.ts`
   imports no value-accessor) is extended to also forbid the new value-gatherer.
4. **Mechanism: gated `git_commit` tool + `git_status` augmentation** -- not a git
   pre-commit hook (bypassable, blocks the human, can't model agent-confirmation)
   and not `run_command` string-parsing (fragile).

## Non-goals (v1)

- Editor gutter decorations; auto-fix / auto-vault (the agent proposes fixes).
- Encoded vaulted values in files (base64/hex/base32 of a secret). The redactor
  already covers the agent-output path; an encoded secret in a committed file is
  rare and lower-value, and precise line-location of an encoded run is fiddly --
  future enhancement. (As with the redactor, no recursive/nested-encoding or
  arbitrary-transform detection either.)
- Intercepting a raw `run_command "git commit"` -- the sanctioned commit path is
  the `git_commit` tool; constraining what commands the agent may run is
  sub-project 3 (sandboxing).
- Scanning history or unstaged-and-untracked files; binary files; files over a
  size cap.
- Blocking the human anywhere.

## Architecture

### agent-core -- detection engine (pure, unit-tested)

New `packages/agent-core/src/redact/scan.ts`:

```ts
export interface SecretFinding {
  line: number; // 1-indexed
  kind: "vaulted" | "pattern";
  name?: string;        // set when kind === "vaulted" (the secret's vault name)
  patternType?: string; // set when kind === "pattern" (e.g. "stripe-secret")
}

export function scanForSecrets(
  text: string,
  vaulted: { name: string; value: string }[],
): SecretFinding[];
```

- **Vaulted:** for each value with `length >= 4` (the redactor's floor), scan each
  line for a literal occurrence (`escapeRegExp(value)`) -> `{ kind: "vaulted",
  name, line }`. (Encoded forms are deferred -- see non-goals.)
- **Pattern:** a module-local `SECRET_PATTERNS` list of **unanchored** provider
  shapes mirroring `validators.ts` (e.g. `/sk_(live|test)_[A-Za-z0-9]{16,}/`,
  `/(AKIA|ASIA)[A-Z0-9]{16}/`, `/gh[pousr]_[A-Za-z0-9]{36,}/`,
  `/-----BEGIN [A-Z ]*PRIVATE KEY-----/`, JWT, postgres-url) -- **excluding the
  public `stripe-publishable` shape** -> `{ kind: "pattern", patternType, line }`.
- Dedupe per `(line, name|patternType)`. The returned objects never contain a
  value substring.

**Export `escapeRegExp` from `redact.ts`** (today module-private) so the literal
match shares one escaper. `redact.ts` stays ASCII-only and `redactSecrets` is
unchanged.

### agent-core/broker -- value gatherer (main-side only)

New `export async function vaultedSecrets(root: string): Promise<{ name: string; value: string }[]>`
(`listSecrets` + `getSecretValue` per entry, dropping nulls). The existing
ad-hoc `allVaultedValues(root)` in `ipc.ts` (used for terminal-tail redaction)
is refactored to `(await vaultedSecrets(root)).map((s) => s.value)` so there is
one value-gathering path (DRY).

### main -- scan orchestrator (NOT in `tools.ts`)

New `packages/app/src/main/secrets/scan.ts`:

```ts
export interface FileLeaks { path: string; findings: SecretFinding[] }
export async function scanStaged(root: string): Promise<FileLeaks[]>;     // staged blobs
export async function scanWorkingSet(root: string): Promise<FileLeaks[]>; // changed working files
```

These list the relevant files (staged blobs for commit; changed files for
status), read each (skipping binary + files over a 1 MB cap, like the editor),
and run `scanForSecrets(content, await vaultedSecrets(root))`. This is the only
place that pulls secret values into a scan; it returns **value-free** `FileLeaks`.

### commit scan -- one core, two behaviors

`commitStaged(root, message, opts?)` gains a pre-commit scan:

- `opts.mode === "advisory"` (default; the renderer `git:commit` IPC): scan,
  **commit regardless**, return `{ committed: true, leaks: SecretLeak[] }`.
- `opts.mode === "gated"` + `opts.confirm` (the agent `git_commit` tool): if
  there are leaks and `!confirm` -> return `{ committed: false, blocked: true,
  leaks }` (no commit); else commit and return `{ committed: true, leaks }`.

`SecretLeak` (in `shared/ipc.ts`, value-free):

```ts
export interface SecretLeak {
  path: string;
  line: number;
  name?: string;
  patternType?: string;
}
```

### MCP -- agent surface

- New tool **`git_commit(message: string, confirm?: boolean)`** in `tools.ts` ->
  `commitStaged(root, message, { mode: "gated", confirm })`. Returns
  `{ committed, blocked?, leaks }`. Added to the locked allowlist. It calls
  `commitStaged`/`scanStaged` -- it imports NO value-accessor.
- **`git_status`** result augmented with `secretLeaks: SecretLeak[]` (from
  `scanWorkingSet`) so the agent sees leaks before it even tries to commit.
- **CI guard** (`tools.test.ts`): extend the forbidden-identifier source scan
  with `vaultedSecrets` (alongside `getSecretValue`, `getGlobalSecret`,
  `neonConnectionUri`, `dbConnString`, `injectInto`), asserting `tools.ts` never
  imports a value source directly.

### renderer -- human surface (advisory only)

`GitSection`: when a commit result (or status) carries `leaks`, render a quiet,
non-modal line -- `WARNING: N file(s) contain secret values` -- expandable to
`name`/`patternType` + `path:line`. It never blocks or disables the commit
button. Reuses the existing `GitSection`; no modal, no new overlay.

## Data flow

- **Human commit:** GitSection -> `git:commit` IPC -> `commitStaged(advisory)` ->
  commit + leaks -> GitSection shows the quiet indicator.
- **Agent commit:** agent -> `git_commit(message)` -> `commitStaged(gated)` -> if
  leak & `!confirm`: `{ blocked, leaks }` -> the agent surfaces it to the user
  and re-calls `git_commit(message, confirm: true)` -> commit.
- **Agent status:** agent -> `git_status` -> `secretLeaks` -> aware before it
  commits.

## Error handling

- A scan that throws (read error, etc.) is logged and treated as **no findings**
  (fail-open) for v1: a scanner bug must never break committing, and the agent
  still has `git_status` awareness. (A fail-closed agent gate -- "scan failed ->
  require confirm" -- is noted as future hardening.)
- Files over the 1 MB cap or detected as binary are skipped (not scanned); this
  matches the editor's read cap.
- A missing/locked keychain value yields no pair for that secret (it is simply
  not scanned for), never an error.

## Testing

- `scanForSecrets` units: vaulted literal (line-located), pattern
  (stripe/aws/github/pem/jwt), length floor, multi-line, dedupe, and **no value
  substring in any finding**.
- `commitStaged` dual behavior: advisory commits and returns leaks; gated blocks
  without `confirm` and commits with `confirm`; a clean staged set commits
  normally either way.
- `git_status` `secretLeaks` shape.
- CI guard extended (`tools.ts` forbids `vaultedSecrets`).
- Secret-blind assertion: run `scanStaged` over content containing a known
  vaulted value; assert the serialized result contains no substring of the value.
- Headless MCP probe of the `git_commit` gate (blocked without confirm, commits
  with confirm) + manual gate.

## Constraints

- ASCII-only in `agent-core/**` (redact, scan, broker), `main/**`,
  `shared/ipc.ts`, `preload/index.ts`, `mcp/tools.ts` (CJS bundling -- use `--`).
- Reuses: `escapeRegExp` (newly exported from `redact.ts`), `validators.ts` provider
  shapes (unanchored variants), `listSecrets`/`getSecretValue`,
  `commitStaged`/`gitStatusFor`, the MCP tool registry + CI guard, `GitSection`.
- No new runtime dependency.
