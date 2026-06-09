# Security & Correctness Audit -- 2026-06-09

Tracked backlog from a full codebase audit. ~78 unique findings (some Part B
items duplicate each other / Part A -- independent corroboration noted).

**Systemic theme:** the secret/vault boundary is enforced INCONSISTENTLY --
several renderer->main `fs:` / `pty:` handlers skip the guard their siblings
apply, and redaction keys on the named/current subset rather than ALL vaulted
values. One class of fix (uniform `assertNotVault` + sender-ownership checks +
redact-against-all-vaulted + cwd containment + an audit mutex) closes most of the
criticals/highs.

**Working it:** CRITICAL -> HIGH, batched by class. Each finding is independently
re-verified against the code before fixing (verdict in the commit). `[ ]` = open,
`[x]` = fixed, `[~]` = verified-but-deferred, `[!]` = refuted/nuanced on review.

---

## PART A -- VERIFIED BY THE AUDIT (re-verified here as we fix)

### CRITICAL
- [x] **C1** `run_command` exposes the full `process.env` + login-shell env to the agent, unredacted; redaction set = only the named injected secrets, and the command classifies to nothing so the gate allows it. `agent-core/src/command/run.ts:117,137-141,149`. Fix: redact against ALL vaulted values; build the child env from a minimal allowlist (not raw `process.env`).
- [x] **C2** Concurrent `appendAudit` forks the hash chain (non-atomic read->modify->write, no lock) -> `verifyAuditChain` fails forever. `agent-core/src/audit/audit.ts:63-103`. Fix: serialize appends through an in-process async mutex keyed by logFile.
- [x] **C3** MCP `run_command` `cwd` arg escapes the project and bypasses the `outsideWorkspace` gate (forwarded to spawn with no containment). `app/src/main/mcp/tools.ts:310-339`. Fix: `path.resolve(root, cwd)` and reject unless inside root.
- [x] **C4** `redactedTail`/`redactedPreview` truncate by line BEFORE redacting -> a multi-line secret (PEM) gets split, surviving lines reach the agent. `agent-core/src/terminal/tail.ts:43-58`. Fix: redact the full buffer first, then truncate.
- [x] **C5** `redactConnStrings` leaks the password tail when the password contains a raw `@` (stops at first `@`; RFC/Postgres use the last). `agent-core/src/db/connstr.ts:38`. Fix: userinfo run greedy to the LAST `@` before the host.
- [x] **C6** `isDangerousEnvName` misses loader/command-hijack names (BASH_ENV, ENV, GIT_SSH_COMMAND, GIT_EXTERNAL_DIFF, PROMPT_COMMAND, ZDOTDIR, BASH_FUNC_*, PERL5OPT, PYTHONSTARTUP...). `agent-core/src/broker/dangerous.ts:7-28`. Fix: expand the set (incl. `BASH_FUNC_*` prefix).
- [x] **C7** `fs:writeFile` has no vault guard -> renderer can destroy/forge the audit chain + vault metadata (every other mutating `fs:*` calls `assertNotVault`). `app/src/main/ipc.ts:342-349` + `write.ts:8-15`. Fix: `assertNotVault(relPath)` in the handler (+ self-guard in `writeWorkspaceFile`).

### HIGH
- [x] **H1** `run_command` redaction covers only the named injected secrets, not all vaulted. `command/run.ts:114-117,130,149`. (Same fix as C1.)
- [x] **H2** `outsideWorkspace` classifier misses `~/...` tilde (the spec's own example) -- trailing `\b` never matches between `~` and `/`. `command/policy.ts:36`. Fix: drop the broken `\b`; match a leading tilde token; catch `${HOME}`.
- [x] **H3** `privilege` block defeated by a path to the binary (`/usr/bin/sudo`, `./sudo`). `command/policy.ts:23,38`. Fix: match the program basename after stripping any leading path.
- [x] **H4** A torn/partial last audit line (crash mid-write) is glued to the next entry (`appendFile` adds only a trailing `\n`, never checks). `audit/audit.ts:87`. Fix: ensure trailing newline before appending / write atomically.
- [x] **H5** Catastrophic O(n^2) backtracking in `redactConnStrings` hangs main on one long line (~97s on 400k chars). `db/connstr.ts:38`. Fix: non-overlapping / length-bounded userinfo class.
- [x] **H6** Lowercase base32 encoding of a secret bypasses redaction (scan only matches uppercase `[A-Z2-7]`). `redact/redact.ts:102-106`. Fix: match base32 case-insensitively.
- [x] **H7** `fs:readFile` has no vault guard -> renderer can read the secret-name inventory + full audit log. `app/src/main/ipc.ts:324-327`. Fix: `assertNotVault(relPath)` (mirror `fs:readImage`).
- [x] **H8** `fs:listDir` has no vault guard + `listDirectory` doesn't block listing INTO `.airlock` (IGNORED filter only drops it as a child). `app/src/main/ipc.ts:310-313` + `tree.ts:133-154`. Fix: `assertNotVault` in handler + reject `targetsVault(relPath)` in `listDirectory`.

### MEDIUM
- [x] M1 Agent-controlled `cwd` to spawn, no containment -- `command/run.ts:143` (same root as C3).
- [ ] M2 Staged rename diff shows empty original instead of HEAD content -- `git/versions.ts:55-58`.
- [ ] M3 `appendAuditAt` links over a corrupt line (writer skips nulls, verifier rejects them) -- `audit/audit.ts:70-77`.
- [x] M4 Lowercase percent-encoding (`%2f`) of a secret bypasses redaction -- `redact/redact.ts:108-114`.
- [x] M5 JSON-escaped form of a secret (quote/backslash) bypasses redaction -- `redact/redact.ts:124-132`.
- [x] M6 `redactConnStrings` ignores credentials in query parameters -- `db/connstr.ts:38`.
- [x] M7 `readMeta` doesn't validate parsed JSON is an array -- `broker/meta.ts:18-25`.
- [x] M8 Corrupt `secrets.json` silently degrades to empty list + overwrites the `.bak` -- `broker/meta.ts:18-45`.
- [ ] M9 `move()` check-then-rename races, silently clobbers -- `workspace/fileOps.ts:32-41`.
- [ ] M10 `duplicate()` races and `cp(force)` silently overwrites/merges -- `workspace/fileOps.ts:58-65`.

### LOW
- [ ] L1 Output truncation/chunk boundaries split a secret past exact-match redaction -- `command/run.ts:45-62`.
- [ ] L2 `gitPush` opaque error in detached HEAD -- `git/ops.ts:100-119`.
- [ ] L3 `assertBranchName` permits leading-dot / `.lock` names -- `git/ops.ts:13-18`.
- [ ] L4 `computeHash` covers only 5 fields; extra top-level keys unprotected -- `audit/audit.ts:21-30`.
- [ ] L5 `withDb` disables TLS cert validation (`rejectUnauthorized:false`) -- `db/client.ts:15-17`.
- [x] L6 `importDotEnv` silently drops a secret named `__proto__` then deletes the `.env` -- `broker/dotenv.ts:26-46`.
- [x] L7 `setSecret` accepts empty/whitespace-only values -- `broker/broker.ts:21-51`.

---

## PART B -- PENDING VERIFICATION (verify before fixing)

### CRITICAL
- [ ] PB-C1 `open_tab` -> `workspace:open` sets the agent root to ANY path, zero validation -- `app/src/main/ipc.ts:256-260`.
- [ ] PB-C2 `pty:create` stale `rootForEvent` re-read after async gap tags `sessionRoots` with the wrong project -- `ipc.ts:971,1014`.
- [ ] PB-C3 Vaulted MULTI-LINE secret never detected by the pre-commit leak scan (per-line `includes`) -- `redact/scan.ts:43-49`.
- [ ] PB-C4 `fsWatch` map keyed by `WebContents.id` but disposed via `BrowserWindow.id` -> watchers never closed -- `fsWatch.ts:29`.

### HIGH (Part B)
- [ ] PB-H1 Theme change rebuilds the editor from original file content, discarding unsaved edits -- `EditorPane.tsx:150-292` (separate-effect fix).
- [ ] PB-H2 Cross-terminal data written to the wrong xterm during PTY-create race -- `TerminalPane.tsx:112-141`.
- [ ] PB-H3 Drag-to-reorder lost when `dragleave` fires before `drop` -- `FileTree.tsx:130-142`.
- [ ] PB-H4 Deleted/rotated secret still in the PTY ring buffer returned un-redacted -- `ipc.ts:1099-1101` (redact against all-ever-vaulted / scrub on delete).
- [ ] PB-H5 MCP bearer token in the process argv (`ps` leak) -- `mcp/register.ts:49-62` (pass via env / 0600 file).
- [ ] PB-H6 `pty:input`/`resize`/`kill` missing window-ownership check -> cross-window injection -- `ipc.ts:1058-1086` (found 3x).
- [ ] PB-H7 `restartActiveTerminal` inverted guard leaves the tab empty -- `restartActiveTerminal.ts:19-21`.
- [ ] PB-H8 `fillActiveTab` drops the blank tab's terminal split/files -- `store.ts:625-653`.
- [ ] PB-H9 `replaceActiveProject` leaves a stale project-level split -- `store.ts:658-672`.
- [ ] PB-H10 Crashed `typescript-language-server` never reaped/restarted -- `lsp/client.ts:79-140`.
- [ ] PB-H11 Human 'advisory' commit is NOT fail-open -- scan/keychain error blocks the human's commit -- `secrets/commit.ts:13-18`.
- [ ] PB-H12 `SecretsSection` shows stale plaintext after a secret is updated -- `SecretsSection.tsx:17,51-62`.
- [ ] PB-H13 `savePrefs` unguarded read-modify-write race -- `prefs.ts:167-180`.
- [ ] PB-H14 `runAgentCommand` TOCTOU between `isDestroyed()` and `send()` -- `agent-commands.ts:45-56`.

### MEDIUM / LOW (Part B)
See the original audit message (2026-06-09) for the full MEDIUM (19) + LOW (19)
Part B index -- folded in here as we reach them. Notable: EditorPane cleanup
flush loses last edit; `lspDidClose` not awaited on switch; tsserver children
not killed on quit; non-constant-time bearer compare; `host:probe` unauth port
prober; reveal signal never cleared; working-tree files >1MB HEAD-scanned only;
`uriToRel` Windows file:// URIs.
