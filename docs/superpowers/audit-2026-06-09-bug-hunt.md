# AirLock — comprehensive bug & security audit

> Generated 2026-06-09 by a multi-agent find→adversarially-verify workflow (17 subsystem reviewers on Opus for security-critical areas + Sonnet elsewhere; independent skeptic verification). Baseline before audit: 533 tests pass, typecheck clean, lint clean.

**Totals:** 90 findings across 17 subsystems — **Part A (verified):** 32 (7 critical, 8 high, 10 medium, 7 low) — **Part B (pending verification):** 58 (4 critical, 16 high, 19 medium, 19 low).

## Executive summary

A multi-agent audit reviewed all 17 subsystems of AirLock (agent-core + Electron main/preload/renderer)
with one deep reviewer per subsystem, then adversarially verified each finding with independent skeptics.
The build is **green** going in — 533 unit tests pass, `tsc` is clean, Biome is clean — so every issue
below is a defect that the existing test/type/lint nets do **not** catch.

**The headline: the green suite hides real holes, and they cluster on the one boundary AirLock exists to
protect — the secret boundary.** Of 32 adversarially-verified findings, **7 are critical**, and most of
those are secret-leak or vault-containment failures that directly contradict the product thesis ("the
agent is structurally unable to read your secrets"):

- **`run_command` hands the agent the entire `process.env` + login-shell env** (every injected secret from
  prior commands, plus the user's ambient secrets) — the agent reads secrets it should never see.
- **The MCP `run_command` `cwd` argument escapes the active project**, and several renderer-facing `fs:`
  IPC handlers (`fs:writeFile`, `fs:readFile`, `fs:listDir`) have **no vault guard** — the renderer (or an
  agent driving it) can read or destroy the `.airlock` secret vault.
- **Redaction is exact-match and misses encodings** — lowercase base32, percent-encoding, and JSON-escaping
  of a secret all survive redaction; and `redactedTail` **truncates the terminal tail by line *before*
  redacting**, so a secret can slip through in the tail the agent reads.
- **`isDangerousEnvName` misses a whole class of loader / command-injection env names**, so a crafted
  secret name can hijack a spawned process.
- **Concurrent audit appends fork the hash chain** (the tamper-evidence guarantee breaks under normal
  concurrent IPC), and **`redactConnStrings` leaks the password tail** for some connection-string shapes.

### Cross-cutting themes (the root causes worth fixing once)

1. **Vault containment is enforced inconsistently.** Some `fs:` IPC handlers call the `assertNotVault` /
   `targetsVault` guard; `fs:writeFile`, `fs:readFile`, and `fs:listDir` do not. The renderer is treated as
   trusted in spots — it shouldn't be. *(Multiple critical/high findings; also a pending IPC-bridge one.)*
2. **Redaction must be encoding-aware and redact-before-truncate.** The current value-exact-match approach
   is bypassed by any encoding that preserves the bytes (base32/percent/JSON) and by line-truncation
   ordering. This is one fix applied across `redact.ts` + `terminal/tail.ts`.
3. **PTY / IPC handlers lack sender-window ownership checks.** `pty:input` / `pty:resize` / `pty:kill` act
   on a session id with no check that the calling window owns it — cross-window control + abuse surface.
   *(Pending — high priority to verify.)*
4. **Unguarded read-modify-write races.** The audit chain, `prefs.json`, and the secrets meta file all do
   read → modify → write with no lock; concurrent IPC calls corrupt or lose data.
5. **Process / watcher lifecycle leaks.** `typescript-language-server` children and `fsWatch` watchers are
   not reliably reaped on project/window close.

### Status of this report

This run was interrupted by a session token limit during the verification phase. **32 findings completed
adversarial verification (Part A — high confidence). 58 findings were found by the reviewers but their
verifiers were killed before voting (Part B — candidates, may contain false positives).** All 90 were
recovered from the run journal; nothing was lost. The 4 *pending criticals* in Part B (IPC containment
escape via `open_tab`, a multi-line secret value evading the pre-commit leak scan, a stale-root PTY race,
and an `fsWatch` key/dispose mismatch leak) should be verified first.


---

## Part A — Verified findings (32)

_Each survived adversarial verification by independent skeptics._


### 🟥 CRITICAL

#### 🟥 CRITICAL — run_command exposes the entire process.env + login-shell env to the agent UNREDACTED (agent can `env`/`printenv` every host secret)

- **Location:** `packages/agent-core/src/command/run.ts:117, 137-141, 149`  
- **Subsystem:** Command policy + injected run  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const values: string[] = [];
... (values only ever gets the NAMED injectSecrets pushed at line 130) ...
const env = {
  ...(process.env as Record<string, string>),
  ...(opts.baseEnv ?? {}),
  ...injectedEnv,
};
...
const output = redactSecrets(combined, values);
```

**Why it's a bug:** The child shell is spawned with the FULL Electron-main process.env AND opts.baseEnv (production wires this to the captured login-shell env: index.ts `getBaseEnv: () => loginEnv`). But the redaction `values` array contains ONLY the secrets the agent explicitly named in injectSecrets. So any credential living in the user's shell env (AWS_SECRET_ACCESS_KEY, OPENAI_API_KEY, GITHUB_TOKEN -- the most common place dev secrets live) is injected into the child and is NOT in the redaction set. The agent simply runs run_command("env") or run_command("printenv AWS_SECRET_ACCESS_KEY") -- no injectSecrets needed, and those commands classify to nothing so the gate returns run:true unconditionally -- and reads them all in plaintext. This directly breaks the product's central invariant that the agent is STRUCTURALLY UNABLE to read your secrets. Note the divergence from the human-terminal path (ipc.ts:1100) which redacts against vaultedSecrets(root) (ALL vaulted values); the agent path is strictly weaker.

**Trigger / repro:** Vault nothing. With AWS_SECRET_ACCESS_KEY set in the user's shell (so it is in loginEnv), agent calls run_command({command:"printenv AWS_SECRET_ACCESS_KEY"}). classifyCommand returns [] -> run:true. runCommand injects process.env+baseEnv (incl. the key) into sh, the command echoes it, redactSecrets is called with values=[] -> nothing redacted -> the key is returned to the agent verbatim.

**Suggested fix:** Do not blindly spread process.env/baseEnv into the agent child. Either (a) build the child env from a minimal allowlist (PATH, locale, plus the named injected secrets) instead of inheriting the whole environment, and/or (b) expand the redaction `values` to include EVERY vaulted secret value (vaultedSecrets(root)) AND the values of sensitive baseEnv/process.env vars, exactly as the PTY path does. Inheriting the full env into an agent-driven shell is the leak; at minimum it must all be in the redaction set.

---

#### 🟥 CRITICAL — Concurrent appendAudit/appendAuditAt calls fork the chain at the same prevHash and permanently break verifyAuditChain

- **Location:** `packages/agent-core/src/audit/audit.ts:63-89 (appendAuditAt); same body reached via appendAudit at 91-103`  
- **Subsystem:** Hash-chained audit  •  **Category:** race-condition  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const entries = (await readEntries(logFile)).filter((e): e is AuditEntry => e !== null,);
  const prevHash = entries.length > 0 ? (entries[entries.length - 1]?.hash ?? GENESIS) : GENESIS;
  ...
  const entry: AuditEntry = { ...partial, hash: computeHash(partial) };
  await mkdir(path.dirname(logFile), { recursive: true });
  await appendFile(logFile, `${JSON.stringify(entry)}\n`, "utf8");
```

**Why it's a bug:** The append is a non-atomic read-modify-write: read the whole file -> pick the last hash -> compute -> appendFile, with awaits in between and NO mutex, queue, or file lock anywhere (confirmed: grep for Mutex/lock/queue/O_EXCL around audit + broker + mcp finds nothing). If two appends run concurrently they both read the same last-entry hash (or both read an empty file and both use GENESIS) and write two entries with the SAME prevHash. verifyAuditChain walks linearly and requires e.prevHash === prev for every line, so the second forked entry makes the whole chain return false forever. This is reachable in normal operation, not just a stress test: appendAudit is fired from many independent, un-serialized async paths -- IPC handlers (secret.reveal/copy at ipc.ts:505/523, terminal.read at ipc.ts:1132), the MCP agent tools (command.run / command.policy.blocked in mcp/tools.ts and command/run.ts), and broker ops (secret.set/delete/inject). An agent issuing parallel tool calls, or a terminal spawn's secret.inject overlapping a get_terminal_tail, races immediately. Empirically reproduced: 20 parallel appendAudit calls produced 20 lines, 19 of which pointed at GENESIS, and verifyAuditChain returned false. The product's core promise is 'audit tampering going unnoticed (hash chain verification)' and 'fail-closed if the audit log cannot be written, agent actions stop' -- a chain that self-invalidates under benign concurrency makes verifyAuditChain useless (an attacker's real tampering is indistinguishable from a routine race) and, if fail-closed is ever wired to verifyAuditChain, would halt the agent spuriously.

**Trigger / repro:** await Promise.all(Array.from({length:20},(_,i)=>appendAudit(root,'user',`op${i}`,{i}))); then verifyAuditChain(root) === false and 19/20 entries have prevHash === GENESIS.

**Suggested fix:** Serialize all appends through a single in-process async mutex/promise-chain keyed by logFile (e.g. an await-able queue so each append's read-modify-write runs to completion before the next starts). The read of prevHash and the appendFile must be one critical section. For cross-process safety (multi-window already mitigated by the single-instance lock, but defense-in-depth) consider an O_EXCL lockfile or an append-with-fsync + a periodic re-link/repair step. At minimum add a per-file Promise chain in audit.ts: lastWrite = lastWrite.then(() => doAppend()).

---

#### 🟥 CRITICAL — run_command `cwd` argument escapes the active project and bypasses the outsideWorkspace policy gate

- **Location:** `packages/app/src/main/mcp/tools.ts:310-339 (cwd forwarded); gate at 314; agent-core run.ts:143`  
- **Subsystem:** MCP IDE-bridge server  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
async ({ command, injectSecrets, cwd, confirm }) => {
  const root = deps.getWorkspaceRoot();
  if (!root) return err(NO_WORKSPACE);
  const policy = (await loadPrefs(deps.prefsFile)).agentPolicy;
  const gate = gateCommand(command, policy, confirm ?? false);   // <-- only inspects `command`, never `cwd`
  ...
  await runCommand(root, command, { injectSecrets, cwd, baseEnv: deps.getBaseEnv() })  // cwd passed through unchecked
// agent-core/src/command/run.ts:143  -> const res = await runner.run(command, { cwd: opts.cwd ?? root, ... })  // spawn cwd = attacker-supplied, no containment check
```

**Why it's a bug:** The brief's invariant is that run_command only touches the ACTIVE project, and the agent-command-policy design names `outsideWorkspace` as the 'cred/exfil path' covering 'abs paths outside root, .. escapes'. But gateCommand only runs classifyCommand(command) over the COMMAND STRING; the separate `cwd` parameter is never classified and never validated to be inside `root`. A malicious/confused agent calls run_command("cat .env", { cwd: "/Users/victim/other-project" }) — an innocent-looking command that the outsideWorkspace heuristic cannot flag (no ~, $HOME, .., /etc, or abs path in the command text) — and it executes in an arbitrary directory, reading any other project's files. This is a true cross-project escape. It is compounded two ways: (1) run_command's redactor only scrubs THIS project's vault-injected values, so files read from the other directory come back unredacted, and (2) the `command.run` audit record (run.ts:150) logs `command` and injected `names` but NOT `cwd`, so the out-of-project execution leaves no trace of where it ran.

**Trigger / repro:** With a workspace open at /proj, the agent calls run_command({ command: "cat config/secrets.yaml", cwd: "/Users/you/other-private-repo" }). Command runs in /Users/you/other-private-repo (escaping /proj), returns that repo's file contents, and no policy ask/block fires because the command string is clean.

**Suggested fix:** Resolve and contain cwd before spawning: in tools.ts (or run.ts) compute const dir = path.resolve(root, cwd ?? ".") and reject (clean tool error) unless dir === root || dir.startsWith(root + path.sep). Alternatively feed the resolved cwd into classifyCommand so an out-of-root cwd trips the outsideWorkspace gate exactly like a `..`/abs-path in the command would. Also include the resolved cwd in the command.run audit payload.

---

#### 🟥 CRITICAL — redactedTail/redactedPreview truncate by line BEFORE redacting, leaking the surviving lines of a multi-line secret (e.g. a PEM private key)

- **Location:** `packages/agent-core/src/terminal/tail.ts:43-58`  
- **Subsystem:** Output redaction  •  **Category:** data-loss  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
export function redactedTail(raw, values, lines) {
  return redactSecrets(lastLines(cleanTerminalOutput(raw), lines), values);
}
... redactedPreview => redactSecrets(previewLines(cleanTerminalOutput(raw), n), values)
```

**Why it's a bug:** Redaction is applied AFTER the text is cut to the last N lines. A vaulted secret value can legitimately contain newlines -- the spec explicitly supports multi-line secrets (docs/.../secrets-phase.md: parseDotEnv('PEM="line1\nline2"') => {PEM:'line1\nline2'}, and SNOWFLAKE_KEY is a multi-line PEM private key). When such a value straddles the line window, lastLines()/previewLines() keep only some of its lines; those surviving lines no longer contain the FULL value, so redactSecrets' exact-match (and every encoded pass, which also keys off the full value) never fires, and the partial key bytes reach the agent verbatim. Confirmed by execution: with PEM='-----BEGIN KEY-----\nLINE1SECRETPART\nLINE2SECRETPART\n-----END KEY-----', redactSecrets on the full buffer masks it, but redactedTail(buf,[PEM],4) returns 'LINE2SECRETPART\n-----END KEY-----\ndone\nbye' -- LINE2SECRETPART leaks. This is the worst-case for 'structurally unable to read your secrets': a private key partially exfiltrated through the agent's terminal-read tool.

**Trigger / repro:** Vault a multi-line secret (PEM key) -> a process prints it (cat key.pem, or app logs its key on error) into a terminal -> agent calls get_terminal_tail with a line count that lands mid-key -> surviving key lines returned un-redacted.

**Suggested fix:** Redact BEFORE truncating: clean -> redactSecrets(full) -> then lastLines/previewLines. Redacting the whole cleaned buffer first guarantees every full occurrence of a multi-line value is masked to *** before any line-window cut. (Same fix for redactedPreview.) If buffer size is a concern, redact then slice; the literal pass is linear.

---

#### 🟥 CRITICAL — redactConnStrings leaks password tail when password contains a raw '@' (stops at FIRST @ instead of last)

- **Location:** `packages/agent-core/src/db/connstr.ts:38 (and applied at 47)`  
- **Subsystem:** Postgres + Neon  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const CONNSTR_USERINFO_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@\s/]*@/g;
...
return text.replace(CONNSTR_USERINFO_RE, "$1***@");
```

**Why it's a bug:** The userinfo run [^@\s/]* stops at the FIRST '@'. Per RFC 3986 the userinfo/host boundary is the LAST '@' before the host, and Postgres accepts passwords containing '@'. So for a password with a raw '@' (e.g. npg_p@ssw0rd), only the part up to the first '@' is masked and the tail after it survives. This is the security-critical defense-in-depth scrubber (file comment: 'so a driver/DNS error that echoes a full connection string cannot leak the password across IPC, regardless of pg internals'). It runs at the IPC error boundary (db:ping/tables/rows, neon:ping/tables/rows in packages/app/src/main/ipc.ts) AND inside redactSecrets (packages/agent-core/src/redact/redact.ts:133), the final pass before command output reaches the AGENT. Confirmed: input 'postgres://user:p@ssw0rd@ep-foo.aws.neon.tech/db' -> 'postgres://***@ssw0rd@ep-foo.aws.neon.tech/db' (leaks 'ssw0rd'); 'postgres://u:a@b@c@host/db' -> 'postgres://***@b@c@host/db'. The existing leak-fixture test only uses an @-free password (npg_SECRETvalue) so it passes while this path leaks. This directly breaks the product thesis (agent must be structurally unable to read secrets).

**Trigger / repro:** redactConnStrings('connect ECONNREFUSED postgres://neondb_owner:npg_p@ss@ep-foo.aws.neon.tech/db') returns '...postgres://***@ss@ep-foo.aws.neon.tech/db' -- the password tail 'ss' (and for longer pws like p@ssw0rd, 'ssw0rd') crosses to the renderer/agent.

**Suggested fix:** Make the userinfo run greedy up to the last '@' before the host terminator: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/]*@/g . Verified: this redacts all three cases to 'scheme://***@host/...'. Add tests with an '@' inside the password (e.g. p@ss, a@b@c) to lock it in.

---

#### 🟥 CRITICAL — isDangerousEnvName misses an entire class of loader/command-hijack env names (BASH_ENV, ENV, GIT_SSH_COMMAND, GIT_EXTERNAL_DIFF, PROMPT_COMMAND, ZDOTDIR, BASH_FUNC_*, PERL5OPT, PYTHONSTARTUP...) — a hostile .env vaults one, then it is injected into every agent command and terminal

- **Location:** `packages/agent-core/src/broker/dangerous.ts:7-28`  
- **Subsystem:** Secret broker  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const EXACT = new Set([
  "PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "SHELL",
  "HOME",
  "TMPDIR",
  "ELECTRON_RUN_AS_NODE",
]);

const PREFIXES = ["DYLD_", "LD_"];

export function isDangerousEnvName(name: string): boolean {
  return EXACT.has(name) || PREFIXES.some((p) => name.startsWith(p));
}
```

**Why it's a bug:** The invariant explicitly requires stripping ALL loader-hijack names and names BASH_ENV as one that must not slip through. The set covers PATH/DYLD_/LD_/NODE_OPTIONS but omits the rest of the well-known arbitrary-code-execution env vars. This same predicate is the ONLY gate at three points: importDotEnv's per-name acceptance, setSecret's store-time guard (broker.ts:33), and the spawn-time last line of defense (filterDangerousEnv in ipc.ts pty:create and isDangerousEnvName in command/run.ts). So an unlisted name passes all three and is both vaulted and injected. I verified the full chain is open for GIT_EXTERNAL_DIFF, GIT_SSH_COMMAND, BASH_ENV, ENV, PROMPT_COMMAND (all return validName:true, passes-store-guard:true, passes-inject-filter:true). I then empirically confirmed exploitability on this machine: `GIT_EXTERNAL_DIFF=/tmp/evil.sh git diff` executed the script (printed GIT_DIFF_HIJACK_FIRED) — this is shell-independent and the agent runs git diff/status constantly via runCommand. GIT_SSH_COMMAND fires on any fetch/push. For the interactive terminal injection path (pty:create spawns the user's login shell), BASH_ENV fires under bash and PROMPT_COMMAND/ZDOTDIR/ENV give per-prompt code execution. Net: a hostile repo ships a .env containing e.g. GIT_EXTERNAL_DIFF=/tmp/pwn, the user clicks Import .env, and from then on the agent (or the user's terminal) silently runs attacker code on the next git/sh invocation — breaking the 'agent can build/run/debug but is structurally contained' thesis.

**Trigger / repro:** Hostile repo .env: `GIT_EXTERNAL_DIFF=/tmp/evil.sh`. importDotEnv vaults it (validateSecretName ok, isDangerousEnvName false). Agent runs `git diff` via runCommand -> isDangerousEnvName('GIT_EXTERNAL_DIFF') is false so it is injected -> git executes /tmp/evil.sh. Confirmed: `env -i GIT_EXTERNAL_DIFF=/tmp/evildiff.sh git diff` ran the script in this environment.

**Suggested fix:** Treat the dangerous set as security-critical and expand it to cover the known hijack classes: add at minimum BASH_ENV, ENV, BASH_FUNC_ (prefix), GIT_SSH, GIT_SSH_COMMAND, GIT_EXTERNAL_DIFF, GIT_PAGER, GIT_CONFIG, GIT_CONFIG_GLOBAL/SYSTEM, PROMPT_COMMAND, PS1..PS4, ZDOTDIR, ENV, CDPATH, IFS, GLOBIGNORE, PERL5LIB, PERL5OPT, PYTHONPATH, PYTHONSTARTUP, RUBYOPT, RUBYLIB, PAGER, EDITOR/VISUAL (when used as exec). Strongly prefer an ALLOWLIST posture for injected names over a denylist, or at minimum match case-insensitively and document that env var names are case-sensitive so the denylist must enumerate exact casing. Add tests asserting each blocked name.

---

#### 🟥 CRITICAL — fs:writeFile has no vault guard — renderer can destroy/forge the audit hash-chain and corrupt vault metadata

- **Location:** `packages/app/src/main/ipc.ts:342-349 (handler) + write.ts:8-15`  
- **Subsystem:** Workspace file ops  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
ipcMain.handle(
  "fs:writeFile",
  (e, root: unknown, relPath: unknown, content: unknown) => {
    if (typeof relPath !== "string" || typeof content !== "string")
      throw new Error("Invalid payload");
    return writeWorkspaceFile(resolveRoot(e, root), relPath, content);
  },
);   // <-- NO assertNotVault(relPath)
```

**Why it's a bug:** Every other mutating fs:* handler calls assertNotVault first (fs:create line 353, fs:mkdir 358, fs:move 366-367, fs:duplicate 373, fs:trash 378, fs:openExternalFile 337) — the intended invariant (comment at ipc.ts:146-147: the .airlock vault is "never mutated from the UI") is enforced everywhere EXCEPT fs:writeFile. writeWorkspaceFile itself never calls targetsVault; it relies entirely on the caller (write.ts:13 just resolveWithin + writeFile). resolveWithin PERMITS .airlock/* because the vault lives inside root (confirmed: resolveWithin('.', '.airlock/audit/log.jsonl') resolves to <root>/.airlock/audit/log.jsonl, no throw). So a compromised/XSS'd renderer (the untrusted boundary in Electron) can call api.writeFile(root, '.airlock/audit/log.jsonl', '') to truncate the SHA-256 hash-chained audit log — which audit.ts:117-121 documents is silently undetectable ('Silent truncation of trailing entries is undetectable by design') — or rewrite it with forged entries, or writeFile(root, '.airlock/secrets.json', '[]') to wipe the secret-name index and orphan the real keychain entries. This directly breaks the tamper-evident-audit and protected-vault pillars of the product thesis.

**Trigger / repro:** From the renderer console / a compromised dependency: window.airlock.writeFile(currentRoot, '.airlock/audit/log.jsonl', '')  -> audit chain destroyed; verifyAuditChain still returns true on the now-empty file.

**Suggested fix:** Add assertNotVault(relPath); inside the fs:writeFile handler before writeWorkspaceFile, exactly as the sibling mutating handlers do. (Belt-and-suspenders: also make writeWorkspaceFile throw on targetsVault(relPath) so the core module is safe regardless of caller.)

---


### 🟧 HIGH

#### 🟧 HIGH — Redaction set for run_command covers only the named injected secrets, not all vaulted secrets (other vaulted values leak unredacted)

- **Location:** `packages/agent-core/src/command/run.ts:114-117, 130, 149`  
- **Subsystem:** Command policy + injected run  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const names = opts.injectSecrets ?? [];
const values: string[] = [];
...
for (const name of names) {
  const value = await getSecretValue(...);
  ...
  values.push(value);   // only names from injectSecrets ever land in `values`
  ...
}
...
const output = redactSecrets(combined, values);
```

**Why it's a bug:** redactSecrets is only given the values of the secrets the agent named in THIS call. If secret FOO is vaulted but the agent injects only BAR, and the command surfaces FOO's value (e.g. it cats a config file, a .env, a log, or FOO is also present in the inherited env), FOO is not in the redaction set and passes through to the agent verbatim. The human-terminal path deliberately redacts against vaultedSecrets(root) (the FULL set) precisely to avoid this; the agent path -- the higher-trust-boundary path -- redacts against a subset chosen by the (untrusted) agent. An agent can minimize its injectSecrets list to shrink the redaction net while still causing other secrets to be printed.

**Trigger / repro:** Vault FOO=topsecret123 and BAR=other. Agent: run_command({command:"cat .env.local", injectSecrets:["BAR"]}) where .env.local contains FOO=topsecret123. values contains only BAR's value, so `topsecret123` is not redacted and is returned to the agent.

**Suggested fix:** Build the redaction value set from ALL vaulted secrets for the project (vaultedSecrets(root)) regardless of which subset was injected, then add baseEnv/process.env sensitive values. The injected subset should drive ENV injection only, never the redaction scope.

---

#### 🟧 HIGH — outsideWorkspace classifier misses `~/...` (tilde home expansion) -- the spec's own primary example case

- **Location:** `packages/agent-core/src/command/policy.ts:36`  
- **Subsystem:** Command policy + injected run  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
{ category: "outsideWorkspace", re: /(^|\s)(~|\$HOME)\b/ },
```

**Why it's a bug:** `~` is a non-word character and so is `/`. The trailing `\b` (word boundary) requires a word-char/non-word-char transition, which does NOT exist between `~` and `/` (or between `~` and end-of-string, or `~` and most shell metachars). So `cat ~/secrets.txt`, `cp x ~/exfil`, `mv build.tgz ~/`, `cd ~` all FAIL to match and are classified as touching nothing -> gate returns run:true unconditionally. The existing test classifyCommand("cat ~/.ssh/id_rsa") only passes by accident because the SEPARATE /\.(ssh|aws|gnupg|config)\b/ pattern catches `.ssh`; remove the dotfile and the tilde escape is invisible. This is not the conceded 'deliberate obfuscation' limit -- the design doc explicitly lists 'a leading ~/$HOME' as a thing outsideWorkspace catches (spec lines 59, 86). Reading/writing the user's entire home dir is exactly the cred/exfil path this category exists to gate. Also `${HOME}/...` (brace form) is missed entirely (only bare $HOME matches).

**Trigger / repro:** node -e 'console.log(/(^|\s)(~|\$HOME)\b/.test("cat ~/notes"))' prints false. So gateCommand("cat ~/.bashrc_backup", DEFAULT_AGENT_POLICY, false) returns {run:true} -- a home-dir read the policy was supposed to gate.

**Suggested fix:** Drop the broken `\b`. Match a leading tilde token directly, e.g. /(^|[\s;&|=])~(\/|$|[\s;&|])/ plus a user-tilde form ~[a-z], and broaden $HOME to also catch ${HOME} (e.g. /(^|[\s;&|=])\$\{?HOME\b/). Add a test for `cat ~/notes` (no dotfile) so the regression is locked.

---

#### 🟧 HIGH — privilege `block` is absolute in policy but trivially defeated by a path to the binary (`/usr/bin/sudo`)

- **Location:** `packages/agent-core/src/command/policy.ts:23, 38`  
- **Subsystem:** Command policy + injected run  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
{ category: "privilege", re: /(^|[\s;&|])(sudo|doas|pkexec|su)([\s;&|]|$)/ },
... the only abs-path classifier is narrow:
{ category: "outsideWorkspace", re: /(^|\s)\/(etc|root)\b/ },
```

**Why it's a bug:** privilege is the one category whose default is `block` and that the spec states is absolute (confirm cannot override). The pattern requires the char immediately before `sudo` to be start-of-string or one of [\s;&|]. Invoking by path -- `/usr/bin/sudo rm x`, `/bin/su -`, `./sudo` -- puts a `/` or `.` before the keyword, which is NOT in the boundary class, so privilege does NOT fire. And the outsideWorkspace abs-path pattern only matches /etc and /root (and a couple of dotdirs), NOT /usr/bin/..., so NOTHING fires -> gate returns run:true and the command runs with privilege escalation. The block category is bypassable with a fully literal, non-obfuscated path. The same path-prefix hole defeats the destructive rm pattern: `/bin/rm -rf x` and `/sbin/mkfs.ext4 ...` classify to nothing.

**Trigger / repro:** node -e 'console.log(/(^|[\s;&|])(sudo|doas|pkexec|su)([\s;&|]|$)/.test("/usr/bin/sudo rm x"))' -> false. gateCommand("/usr/bin/sudo rm -rf /", DEFAULT_AGENT_POLICY, false) -> {run:true}, fully bypassing the privilege block.

**Suggested fix:** Match the command basename, not a raw boundary: detect the program token after stripping any leading path (e.g. /(^|[\s;&|])([^\s;&|]*\/)?(sudo|doas|pkexec|su)([\s;&|]|$)/), and apply the same basename-aware matching to the rm/dd/mkfs/network patterns so a leading path component cannot evade them.

---

#### 🟧 HIGH — A torn/partial last line (crash mid-write) is glued to the next appended entry because appendFile only adds a trailing newline, never a leading separator

- **Location:** `packages/agent-core/src/audit/audit.ts:87 (appendFile) with 53-56 (split on \n)`  
- **Subsystem:** Hash-chained audit  •  **Category:** data-loss  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
await appendFile(logFile, `${JSON.stringify(entry)}\n`, "utf8");   // line 87
...
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => parseEntry(l));   // lines 53-56
```

**Why it's a bug:** appendFile appends `<json>\n` with NO leading newline and no check that the existing file ends in a newline. The invariant explicitly requires 'a malformed/partial last line is handled (not a crash, not a silent accept)'. If a previous append was torn (process killed/disk-full after writing a partial JSON object with no trailing newline -- exactly what a crash leaves), the next appendAudit concatenates its new entry directly onto that partial line. Reproduced: starting from a partial last line `{"ts":...,"op":"c"` (no newline), the next appendAudit produced the raw line `{"ts":...,"op":"c"{"ts":...,"op":"d",...,"hash":...}` -- a single unparseable line. readEntries (split('\n')) sees it as ONE line that JSON.parse rejects -> the newly-written 'd' entry, which the broker already returned to its caller as a SUCCESS, is now unreadable by readAudit and counts as an integrity failure in verifyAuditChain. So a legitimate, acknowledged audit event is silently lost AND the chain is corrupted by the act of appending after a torn write. This is data loss of an audit record plus undetected corruption of the latest event -- worse than a clean detection, because the writer believes it succeeded.

**Trigger / repro:** Write `${good1}\n${good2}\n{"ts":...,"op":"c"` (torn, no newline). Call appendAudit(root,'user','d',{}). The 'd' entry is glued onto the torn line; readAudit drops both, verifyAuditChain === false, and the returned 'd' entry is absent from the persisted readable log.

**Suggested fix:** Before appending, ensure the file ends with a newline (or write atomically): either open with a check that the last byte is '\n' and prepend one if not, or buffer the read text (already read in readEntries for prevHash) to detect a non-newline-terminated tail and refuse/repair. Better: write the entry as `\n<json>` only when the file is non-empty-and-not-newline-terminated, or use a write-temp-then-rename for the whole line. Also have verifyAuditChain/readEntries detect a non-newline-terminated final line and treat it explicitly as a partial-last-line rather than letting it merge.

---

#### 🟧 HIGH — Catastrophic O(n^2) backtracking in redactConnStrings makes redactSecrets/redactedTail hang the Electron main process on one long line

- **Location:** `packages/agent-core/src/db/connstr.ts:38, 46-48 (invoked from packages/agent-core/src/redact/redact.ts:133)`  
- **Subsystem:** Output redaction  •  **Category:** resource-leak  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const CONNSTR_USERINFO_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@\s/]*@/g;
export function redactConnStrings(text) { return text.replace(CONNSTR_USERINFO_RE, "$1***@"); }
// redact.ts: out = redactConnStrings(out);
```

**Why it's a bug:** On a long run of characters in class [a-zA-Z0-9+.-] (or [^@\s/]) that never completes the '://...@' shape, the engine retries the greedy [a-zA-Z0-9+.-]* from every start offset -> quadratic. Measured against the real code: A-repeated input took 6.0s @100k, 25.0s @200k, 97.4s @400k chars (each doubling ~4x => O(n^2)); I bisected redactSecrets and connstr is the sole quadratic pass (base64/base32/hex/literal/Bearer were all <10ms at 200k). The pty buffer cap is TAIL_CAP=256KB (ipc.ts:122), and a single long line is ONE line so lastLines keeps it whole, so a ~250KB line yields a ~40s synchronous freeze of the main process. redactedPreview runs this on EVERY terminal in listTerminals(), multiplying it. Trivially triggered by the agent: `cat bundle.min.js`, `base64 image.png`, `head -c 250000 /dev/urandom | base64`, or any long delimiter-free token.

**Trigger / repro:** Agent runs a command that prints a ~200-256KB single line with no '@'/whitespace; get_terminal_tail (or get_terminal_tail-list/listTerminals preview) then blocks the main process for tens of seconds.

**Suggested fix:** Make the userinfo class non-overlapping with the scheme so it can't backtrack, e.g. anchor/limit the scheme run and bound the userinfo length, or use a possessive/atomic-equivalent rewrite: /(?<![\w.+-])[a-zA-Z][a-zA-Z0-9+.-]{0,40}:\/\/[^@\s/]{1,512}@/g. Simpler robust option: only attempt the regex on tokens that actually contain '://' (split/scan first), or cap the run length with {0,N}. Confirm with the same timing harness that 256KB input stays sub-100ms.

---

#### 🟧 HIGH — Lowercase base32 encoding of a secret bypasses redaction (only uppercase [A-Z2-7] is decoded)

- **Location:** `packages/agent-core/src/redact/redact.ts:102-106`  
- **Subsystem:** Output redaction  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const b32min = Math.max(8, Math.ceil((minBytes * 8) / 5));
out = out.replace(new RegExp(`[A-Z2-7]{${b32min},}={0,6}`, "g"), (run) => {
  const buf = decodeBase32(run);
  return buf && containsAny(buf, valueBufs) ? PLACEHOLDER : run;
});
```

**Why it's a bug:** The base32 scan regex only matches UPPERCASE base32 ([A-Z2-7]). decodeBase32 itself uppercases, but it is never reached for a lowercase run because the regex doesn't match it. Confirmed by execution with SECRET='testtesttest': the uppercase form 'ORSXG5DUMVZXI5DFON2A' is redacted to '***', but the identical lowercase encoding 'orsxg5dumvzxi5dfon2a' (same secret bytes) passes through untouched ('v=orsxg5dumvzxi5dfon2a'). The invariant explicitly forbids a secret surviving via encoding or case; an agent that pipes the secret through any tool emitting lowercase base32 (or `... | base32 | tr A-Z a-z`) recovers it from output the redactor declared clean.

**Trigger / repro:** echo -n "$SECRET" | base32 | tr 'A-Z' 'a-z' printed to terminal -> get_terminal_tail returns the lowercase base32 -> agent base32-decodes it.

**Suggested fix:** Match base32 case-insensitively: use the alphabet [A-Za-z2-7] in the scan regex (decodeBase32 already toUpperCases before lookup, so lowercase runs decode correctly once matched). Note this widens overlap with the base64 alphabet; that's fine since decode-and-check (not the regex) gates redaction.

---

#### 🟧 HIGH — fs:readFile has no vault guard — renderer can read the secret-name inventory and full audit log

- **Location:** `packages/app/src/main/ipc.ts:324-327 (handler) + read.ts:13-17`  
- **Subsystem:** Workspace file ops  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
ipcMain.handle("fs:readFile", (e, root: unknown, relPath: unknown) => {
  if (typeof relPath !== "string") throw new Error("Invalid payload");
  return readWorkspaceFile(resolveRoot(e, root), relPath);
});   // <-- NO assertNotVault(relPath); contrast fs:readImage one block below which DOES call it
```

**Why it's a bug:** fs:readImage (ipc.ts:328-332) calls assertNotVault but the far more general fs:readFile does not, and readWorkspaceFile (read.ts) never self-guards. resolveWithin permits .airlock/* (it is inside root). So the renderer can read <root>/.airlock/secrets.json — which per broker/meta.ts:5-12 is the full list of every secret's name, provider, validity and timestamps — and <root>/.airlock/audit/log.jsonl (the entire audit trail). The product is marketed as the agent being "STRUCTURALLY UNABLE to read your secrets"; the vault is treated as protected by assertNotVault on 7 sibling channels. Even though raw secret VALUES live only in the OS keychain (not in secrets.json), leaking the complete inventory of secret names + provider metadata to untrusted renderer content is a confidentiality breach of the protected vault and a reconnaissance gift to an attacker.

**Trigger / repro:** window.airlock.readFile(currentRoot, '.airlock/secrets.json') returns {content: '[{"name":"OPENAI_API_KEY",...}]', binary:false}; window.airlock.readFile(currentRoot, '.airlock/audit/log.jsonl') returns the whole chain.

**Suggested fix:** Add assertNotVault(relPath); at the top of the fs:readFile handler (mirroring fs:readImage). Optionally also guard readWorkspaceFile internally.

---

#### 🟧 HIGH — fs:listDir has no vault guard AND listDirectory does not block listing INTO .airlock — vault structure is enumerable

- **Location:** `packages/app/src/main/ipc.ts:310-313 (handler) + tree.ts:133-154 (listDirectory)`  
- **Subsystem:** Workspace file ops  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
// ipc.ts
ipcMain.handle("fs:listDir", (e, root: unknown, relPath: unknown) => {
  if (typeof relPath !== "string") throw new Error("Invalid payload");
  return listDirectory(resolveRoot(e, root), relPath);   // <-- NO assertNotVault
});
// tree.ts listDirectory filters IGNORED on the CHILDREN only:
.filter((d) => !IGNORED.has(d.name))   // removes children NAMED .airlock, but not entries that ARE inside .airlock
```

**Why it's a bug:** listDirectory's IGNORED filter (tree.ts:140) only drops child entries literally named '.airlock' / 'node_modules' / etc. It never rejects the case where the requested relPath IS the vault. Confirmed empirically: listDirectory(root, '.airlock') returns [{name:'audit',type:'dir'},{name:'secrets.json',type:'file'}], and listDirectory(root, '.airlock/audit') returns log.jsonl. Combined with the missing assertNotVault on the fs:listDir handler, untrusted renderer content can fully map the vault (then read it via the unguarded fs:readFile, finding #2). The comment at tree.ts:79-80 claims defense-in-depth ('listDirectory already hides .airlock ... the tree never emits it') — that is true only for listing the PARENT of .airlock, and is false when listing .airlock itself.

**Trigger / repro:** window.airlock.listDir(currentRoot, '.airlock')  ->  enumerates secrets.json + audit/.

**Suggested fix:** Add assertNotVault(relPath); to the fs:listDir handler. Additionally harden listDirectory itself: after resolveWithin, reject when targetsVault(relPath) so the core module can't list into the vault regardless of caller.

---


### 🟨 MEDIUM

#### 🟨 MEDIUM — Agent-controlled `cwd` is passed to spawn with no workspace containment check (escape the project root)

- **Location:** `packages/agent-core/src/command/run.ts:143`  
- **Subsystem:** Command policy + injected run  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const res = await runner.run(command, {
  cwd: opts.cwd ?? root,
  ...
});  // opts.cwd flows straight from the MCP tool's `cwd: z.string().optional()` (tools.ts:331), never validated
```

**Why it's a bug:** The run_command tool accepts an arbitrary `cwd` from the agent (tools.ts inputSchema `cwd: z.string().optional()`) and passes it unmodified to spawn('sh', ['-c', command], { cwd }). Unlike the file tools, which the design says use resolveWithin to stay inside the project root, there is NO resolveWithin/containment on the command cwd. The agent can set cwd to /Users/<user> or any absolute path and run relative-path commands there, sidestepping the whole outsideWorkspace premise (the classifier only inspects the command STRING, never the cwd). Combined with the classifier path-prefix holes above, an agent can operate entirely outside the project without ever tripping outsideWorkspace.

**Trigger / repro:** Agent: run_command({command:"cat .ssh/id_rsa", cwd:"/Users/ricardoramos"}). classifyCommand("cat .ssh/id_rsa") = [] (no `/` prefix, no `~`, no `..`) -> run:true; spawn runs in the home dir; only redaction (against the empty/named-only value set) stands between the key file and the agent.

**Suggested fix:** Resolve and contain the cwd: if opts.cwd is provided, resolve it against root and reject (or clamp to root) anything that escapes the workspace, mirroring the file tools' resolveWithin. At minimum, feed the resolved cwd into the classifier so an out-of-tree cwd is itself treated as outsideWorkspace.

---

#### 🟨 MEDIUM — Staged rename diff shows empty original instead of HEAD content of old path

- **Location:** `packages/agent-core/src/git/versions.ts:55-58`  
- **Subsystem:** Git operations  •  **Category:** correctness  •  **Verification:** ✅ confirmed (1/1 verifiers)


**Evidence**
```
if (which === "staged") {
    original = (await gitShow(root, `HEAD:${relPath}`)) ?? "";
    modified = (await gitShow(root, `:0:${relPath}`)) ?? "";
    truncated = false;
  }
```

**Why it's a bug:** When a file is staged as a rename (porcelain entry `2 R. ...`), `relPath` is the destination (new) path. `HEAD:${relPath}` (e.g., `HEAD:new_name.txt`) does not exist in HEAD — git returns a fatal error, caught by `gitShow`, which returns `null` coerced to `""`. So `original` is always the empty string for any staged rename, making the diff look like a brand-new file instead of a rename. The correct original is `HEAD:<origPath>` (the source path). This also means that for a rename-with-modification, the entire before-side of the diff is lost. The bug is not covered by `versions.test.ts`, which has no rename test for the staged path. Confirmed with `git show "HEAD:new_name.txt"` → `fatal: path 'new_name.txt' exists on disk, but not in 'HEAD'`.

**Trigger / repro:** 1. Commit `old_name.txt`. 2. `git mv old_name.txt new_name.txt`. 3. Open the Git panel and click the staged `R` entry to show the diff. The diff displays empty original vs. full file content instead of unchanged content vs. unchanged content (pure rename) or old content vs. new content (rename with edit).

**Suggested fix:** Accept an optional `origPath: string | null` parameter in `gitFileVersions`. When `which === 'staged'` and `origPath` is provided, resolve original as `HEAD:${origPath}` rather than `HEAD:${relPath}`. Callers (GitSection `showDiff`, `scan.ts`) that already have `origPath` from the `FileChange` struct can pass it through. The `FileVersions` return type is unchanged.

---

#### 🟨 MEDIUM — appendAuditAt links new entries over a corrupt line (last-PARSEABLE hash) while verifyAuditChain rejects any corrupt line, so the chain can never recover and writer/verifier disagree

- **Location:** `packages/agent-core/src/audit/audit.ts:70-77 (writer skips nulls) vs 126-133 (verifier rejects nulls)`  
- **Subsystem:** Hash-chained audit  •  **Category:** correctness  •  **Verification:** ✅ confirmed (2/3 verifiers)


**Evidence**
```
// writer (appendAuditAt):
  const entries = (await readEntries(logFile)).filter((e): e is AuditEntry => e !== null,);
  const prevHash = entries.length > 0 ? (entries[entries.length - 1]?.hash ?? GENESIS) : GENESIS;
// verifier (verifyAuditChain):
  for (const e of entries) {
    if (e === null) return false;
    if (e.prevHash !== prev) return false;
    ...
    prev = hash;
  }
```

**Why it's a bug:** The two halves of the subsystem disagree about corrupt lines. The writer deliberately SKIPS corrupt (null) lines and links the new entry's prevHash to the last *parseable* entry's hash. The verifier treats ANY null line as a hard failure (return false) and walks every line including the corrupt one, expecting prev to advance through it. Consequence: once a single line is corrupted (the torn-write case above, or a partial concurrent write, or external corruption), every subsequently appended entry is internally self-consistent from the writer's view, but verifyAuditChain is stuck returning false forever with no recovery path, AND the appended entry's prevHash points to a hash that is not the immediately-preceding physical line -- so the 'recovered' tail isn't a real chain link across the gap either. This makes verifyAuditChain's false/true signal ambiguous (real tamper vs one stale corrupt line that the writer already 'moved past') and means a malicious agent that can get one corrupt line into the file permanently poisons the verifier's verdict while the writer keeps happily appending. The intent ('a corrupt line makes the chain invalid rather than throwing') is met, but the writer's skip-and-relink behavior is inconsistent with it.

**Trigger / repro:** Corrupt line 1 of a 2-line log to invalid JSON, then appendAudit a 3rd entry: appendAuditAt links entry 3's prevHash to entry 2's hash and returns success, but verifyAuditChain stays false permanently and entry 3 is not chain-reachable across the corrupt line.

**Suggested fix:** Make writer and verifier agree. Either: (a) the writer should refuse to append over a corrupt tail (fail-closed: surface an error so the corruption is handled, matching the spec's fail-closed audit), or (b) define an explicit, hash-anchored 'chain-break/recovery' marker entry that verifyAuditChain understands, so a post-corruption segment can be validated from a known anchor. Do not silently relink across a gap the verifier will reject.

---

#### 🟨 MEDIUM — Lowercase percent-encoding (%2f) of a secret bypasses redaction; only encodeURIComponent's uppercase form is matched

- **Location:** `packages/agent-core/src/redact/redact.ts:108-114`  
- **Subsystem:** Output redaction  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
for (const v of use) {
  const enc = encodeURIComponent(v);
  if (enc !== v) {
    out = out.replace(new RegExp(escapeRegExp(enc), "g"), PLACEHOLDER);
  }
}
```

**Why it's a bug:** encodeURIComponent emits UPPERCASE hex (%2F, %40), but percent-encoding is case-insensitive and many servers/CLIs/loggers emit lowercase (%2f, %40). The redactor only forward-encodes the uppercase variant and exact-matches it, so the lowercase encoding survives. Confirmed by execution: v='p@ss/w&rd=1!' -> uppercase form 'p%40ss%2Fw%26rd%3D1!' is masked, but the lowercase-hex variant 'p%40ss%2fw%26rd%3d1!' passes through unchanged. The agent URL-decodes it to recover the exact secret. Direct violation of the 'no secret survives via percent encoding' invariant.

**Trigger / repro:** A URL with the secret in a query param logged with lowercase percent-encoding (curl verbose, many web frameworks) -> printed to terminal -> survives redaction.

**Suggested fix:** Match percent-encoding case-insensitively. Build a regex from the encoded form where each %XX is allowed in either case, e.g. transform enc by replacing /%([0-9A-F]{2})/g with a char-class per nibble, or post-process the run: scan [%0-9A-Fa-f]+ runs, normalize %XX to uppercase, decodeURIComponent, and compare to the value. Simplest: also run a pass that lowercases candidate %XX sequences before exact-matching, or add the lowercased enc as a second pattern.

---

#### 🟨 MEDIUM — JSON-escaped form of a secret containing a quote/backslash bypasses redaction

- **Location:** `packages/agent-core/src/redact/redact.ts:124-132`  
- **Subsystem:** Output redaction  •  **Category:** security  •  **Verification:** ✅ confirmed (2/2 verifiers)


**Evidence**
```
for (const v of vals) {
  out = out.replace(new RegExp(escapeRegExp(v), "g"), PLACEHOLDER);
}
out = redactEncoded(out, vals); // covers base64/hex/base32/percent only
```

**Why it's a bug:** Neither the literal pass nor redactEncoded handles JSON string escaping. A secret value containing a double-quote or backslash (allowed in passwords/keys) is emitted in JSON output (curl|jq, config dumps, structured logs are pervasive in terminals) with escapes: value 'ab"cd' appears as 'ab\"cd'. Confirmed by execution: redactSecrets('{"k":"ab\"cd"}', ['ab"cd']) returns '{"k":"ab\"cd"}' -- the escaped form leaks (the exact-match looks for ab"cd and never sees ab\"cd). The invariant lists json-escaped explicitly as a must-catch encoding.

**Trigger / repro:** A secret with an embedded " or \ is printed inside JSON (e.g. `curl .../config | jq` or any app logging JSON) -> the \"-escaped secret survives redaction and the agent JSON-unescapes it.

**Suggested fix:** Add a JSON-escape-aware pass in redactEncoded: for each value, also forward-encode its JSON-string representation (JSON.stringify(v).slice(1,-1)) and exact-match that. Optionally also handle the common shell/backslash-escaped variants. Keep it forward-encode-and-match so innocent text is untouched.

---

#### 🟨 MEDIUM — redactConnStrings does not scrub credentials carried in connection-string query parameters

- **Location:** `packages/agent-core/src/db/connstr.ts:38 (and applied at 47)`  
- **Subsystem:** Postgres + Neon  •  **Category:** security  •  **Verification:** ✅ confirmed (2/3 verifiers)


**Evidence**
```
const CONNSTR_USERINFO_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@\s/]*@/g;
```

**Why it's a bug:** redactConnStrings only targets the scheme://userinfo@ form. Postgres/libpq connection strings can also carry the password as a query parameter (e.g. ?password=... or ?options=--password=...), and pg's own error/notice text can echo these. Because this is the defense-in-depth scrubber used both at the IPC boundary and as the last pass in redactSecrets before agent output, a password placed in a query param is not masked. Confirmed: redactConnStrings('postgresql://u:p@host/db?options=--password=zzz') -> 'postgresql://***@host/db?options=--password=zzz' (zzz survives). In redactSecrets the exact-value pass would catch a *registered* secret, but redactConnStrings exists precisely for the case where the raw value is not in the registered values list (a reconstructed/echoed connstr), so this is a real gap in that layer.

**Trigger / repro:** A pg connection failure that echoes 'postgresql://u@host/db?password=hunter2' (or a user-supplied postgres-url secret using ?password=) passes through redactConnStrings with the password intact, then crosses IPC / reaches the agent via redactSecrets.

**Suggested fix:** After the userinfo pass, also redact common credential query params on URIs, e.g. replace (?|&)(password|pgpassword|sslpassword)=([^&\s]+) with $1$2=*** , and mask --password=<run> / password=<run> inside an options= value. Keep it conservative (only known credential keys) to avoid over-redaction.

---

#### 🟨 MEDIUM — readMeta does not validate that the parsed JSON is an array — a valid-but-non-array secrets.json crashes setSecret/upsertMeta/removeMeta/injectInto with a TypeError

- **Location:** `packages/agent-core/src/broker/meta.ts:18-25`  
- **Subsystem:** Secret broker  •  **Category:** error-handling  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
export async function readMeta(root: string): Promise<SecretMeta[]> {
  try {
    const text = await readFile(metaFile(root), "utf8");
    return JSON.parse(text) as SecretMeta[];
  } catch {
    return [];
  }
}
```

**Why it's a bug:** The try/catch only catches read/parse errors. If secrets.json contains valid JSON that is not an array — `{}`, `null`, `42`, or `"..."` — JSON.parse succeeds and the value is returned cast (a lie) as SecretMeta[]. Downstream every consumer then throws an UNHANDLED TypeError: injectInto does `for (const meta of await readMeta(root))` (throws 'is not iterable' for {}/null/number), setSecret does `(await readMeta(root)).find(...)` (throws '.find is not a function'), upsertMeta/removeMeta do `.filter(...)` (throws). This is reachable from a partial/interrupted atomic write that happens to leave valid JSON, manual edit, sync tooling, or a future schema change to an object wrapper. Result: the user can no longer vault, delete, or list ANY secret (setSecret/deleteSecret/listSecrets all throw) until the file is hand-repaired; on the terminal path injectInto's throw is swallowed (fail-open, no secrets) but setSecret surfaces a raw TypeError.

**Trigger / repro:** Write `{}` (or `null`) to <root>/.airlock/secrets.json, then call setSecret(root,'A','v') -> throws `TypeError: (intermediate value).find is not a function`; or injectInto(root,{}) -> `TypeError: object is not iterable`.

**Suggested fix:** After JSON.parse, validate: `const parsed = JSON.parse(text); return Array.isArray(parsed) ? (parsed as SecretMeta[]) : [];` (and ideally filter entries to those with a string `name`). Returning [] here also lets the .bak fallback (see separate finding) kick in instead of throwing.

---

#### 🟨 MEDIUM — Corrupt secrets.json silently degrades to an empty secret list and the .bak backup it writes is never read/restored anywhere — secrets silently stop injecting

- **Location:** `packages/agent-core/src/broker/meta.ts:18-45`  
- **Subsystem:** Secret broker  •  **Category:** data-loss  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
} catch {
    return [];
  }
...
  try {
    await copyFile(file, `${file}.bak`);
  } catch {
    // No existing file yet - first write has nothing to back up.
  }
  await rename(tmp, file);
```

**Why it's a bug:** writeMetaList dutifully maintains a secrets.json.bak on every write, but a grep across packages shows nothing ever reads `${file}.bak` — there is no recovery path, so the backup is dead code that provides false assurance. Meanwhile readMeta's catch maps ANY failure (truncated/corrupt file, e.g. from a crash between writeFile(tmp) and rename, or disk error) to an empty list `[]`. The consequence is silent and security-relevant: listSecrets shows zero secrets and injectInto injects nothing and reports nothing missing (the meta loop simply has no entries), even though the real credential values are still sitting in the OS keychain. The user's app silently runs without the secrets it expects and the redaction value-set (vaultedSecrets/allVaultedValues derive from readMeta) silently becomes empty, weakening output redaction for any value that is still present in the environment by other means.

**Trigger / repro:** Truncate .airlock/secrets.json to invalid JSON (simulating a crash mid-rename). listSecrets returns []; injectInto returns {injected:[],missing:[]} despite keychain still holding every value. The adjacent secrets.json.bak holding the last-good list is never consulted.

**Suggested fix:** On readMeta parse/shape failure, attempt to restore from `${file}.bak` (read+parse it) before falling back to []; if both fail, surface a recoverable error to the UI (e.g. 'secrets index corrupt — N values still in keychain') rather than silently presenting an empty vault. If the .bak is not meant to be a recovery source, remove it to avoid implying durability it does not provide.

---

#### 🟨 MEDIUM — move() check-then-rename races: rename silently clobbers a file that appears in the TOCTOU window (data loss)

- **Location:** `packages/agent-core/src/workspace/fileOps.ts:32-41`  
- **Subsystem:** Workspace file ops  •  **Category:** race-condition  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
export async function move(root, fromRel, toRel) {
  const fromAbs = await resolveWithin(root, fromRel);
  const toAbs = await resolveWithin(root, toRel);
  if (await exists(toAbs)) throw new Error(`Already exists: ${toRel}`);
  await rename(fromAbs, toAbs);   // POSIX rename OVERWRITES an existing file atomically
}
```

**Why it's a bug:** The 'don't clobber' guarantee is a non-atomic check-then-act: exists(toAbs) is awaited, then rename runs. If anything creates toAbs in between (another fs:* IPC from the renderer — the renderer can fire many concurrently — a watcher-triggered op, the agent's terminal, or an external tool), POSIX rename() silently overwrites the destination FILE with no error (confirmed: rename('s.ts','d.ts') over an existing d.ts replaces its contents and the guard is bypassed). The invariant 'write/move must not silently clobber or lose data' fails under concurrency. (Renaming onto a non-empty DIR throws ENOTEMPTY, so the data-loss case is specifically file destinations.)

**Trigger / repro:** Fire move(root,'a.ts','b.ts') and create b.ts concurrently from a second fs IPC; b.ts's original contents are destroyed instead of the move being rejected.

**Suggested fix:** There is no atomic 'rename-if-not-exists' in Node fs, but you can narrow the window by using link()+unlink() for same-filesystem moves, or open the destination with flag 'wx' to reserve the name atomically before renaming, or at minimum re-check immediately and document last-write-wins. For files, copyfile with COPYFILE_EXCL then unlink source is atomic on the dest. Treat move of a file like createFile does for new files (it correctly uses flag:'wx').

---

#### 🟨 MEDIUM — duplicate() races and cp(force=true) silently overwrites/merges the chosen destination

- **Location:** `packages/agent-core/src/workspace/fileOps.ts:58-65`  
- **Subsystem:** Workspace file ops  •  **Category:** data-loss  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
let n = 1;
let outRel = candidate(n);
while (await exists(await resolveWithin(root, outRel))) {
  n += 1;
  outRel = candidate(n);
}
await cp(abs, await resolveWithin(root, outRel), { recursive: true });   // cp defaults force:true
```

**Why it's a bug:** Two issues, both rooted in cp's default force:true (confirmed: fs.cp overwrites an existing destination file, and for directories MERGES into an existing dir keeping unrelated files). (1) TOCTOU: between the while-loop selecting a free outRel and cp writing it, another op can create outRel; cp then silently overwrites/merges it instead of incrementing, destroying user data. (2) Even single-threaded, because cp is force:true rather than force:false (errorOnExist), the only thing preventing a clobber is the non-atomic existence loop — any gap in that logic becomes a silent overwrite rather than a hard error. The invariant 'duplicate must not silently clobber or lose data' is not defensively guaranteed.

**Trigger / repro:** duplicate(root,'src') with a 'src copy' created concurrently after the loop check: cp merges into the pre-existing 'src copy', co-mingling/overwriting its files instead of producing 'src copy 2'.

**Suggested fix:** Pass { recursive: true, force: false, errorOnExist: true } to cp so an unexpectedly-occupied destination throws instead of overwriting; loop and increment on the EEXIST. This makes the no-clobber guarantee atomic at the cp call rather than dependent on the prior exists() race.

---


### ⬜ LOW

#### ⬜ LOW — Output truncation and chunk boundaries can split a secret so exact-match redaction leaks a partial value

- **Location:** `packages/agent-core/src/command/run.ts:45-62`  
- **Subsystem:** Command policy + injected run  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const cap = (buf, chunk) => {
  if (buf.length >= maxBytes) { truncated = true; return buf; }
  const next = buf + chunk.toString("utf8");
  if (next.length > maxBytes) { truncated = true; return next.slice(0, maxBytes); }
  return next;
};
```

**Why it's a bug:** redactSecrets relies on the full secret value appearing contiguously in the captured text (exact-match -> ***, plus single-layer encode-aware). But (a) chunk.toString("utf8") is called per-chunk, so a multibyte UTF-8 sequence split across two data events yields a U+FFFD replacement char that breaks an exact match straddling the boundary; and (b) when output hits maxBytes the value is sliced mid-string, leaving the first half of a secret in the output while the matchable suffix is dropped -- so the redactor never matches and a secret PREFIX is returned. This is a genuine, if narrow, under-redaction (the file's own contract: 'under-redaction leaks'). Independent of the named-only redaction-set bug.

**Trigger / repro:** A secret value V of length 20; set maxBytes so the captured stream is cut 10 bytes into V. Output contains V[0..10] with no match for the full V -> redactSecrets leaves the 10-char prefix of the secret visible.

**Suggested fix:** Accumulate output as a Buffer and decode once at the end (avoids per-chunk multibyte splitting), and run redaction BEFORE truncating to maxBytes (or pad the truncation boundary by the longest secret length and re-redact), so a value cut by the byte cap is still masked.

---

#### ⬜ LOW — gitPush throws an opaque 'ref HEAD is not a symbolic ref' error in detached HEAD

- **Location:** `packages/agent-core/src/git/ops.ts:100-119`  
- **Subsystem:** Git operations  •  **Category:** error-handling  •  **Verification:** ✅ confirmed (1/1 verifiers)


**Evidence**
```
let hasUpstream = true;
  try {
    await runGit(root, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
  } catch {
    hasUpstream = false;
  }
  if (hasUpstream) {
    await runGit(root, ["push"]);
    return;
  }
  const branch = (
    await runGit(root, ["symbolic-ref", "--short", "HEAD"])
  ).trim();
  await runGit(root, ["push", "-u", "origin", branch]);
```

**Why it's a bug:** In a detached HEAD state, `rev-parse @{u}` fails with `HEAD does not point to a branch`, causing `hasUpstream = false`. Execution then falls through to `git symbolic-ref --short HEAD`, which also fails — this time with `fatal: ref HEAD is not a symbolic ref`. This error propagates uncaught from `gitPush`, surfacing a confusing internal git error to the user instead of a clear `Cannot push: HEAD is detached` message. Confirmed with a real detached HEAD repo: both commands fail as described.

**Trigger / repro:** 1. Check out a commit by SHA (`git checkout <sha>`), entering detached HEAD. 2. Click the Push button in the AirLock Git panel. The operation fails with `ref HEAD is not a symbolic ref` rather than a user-friendly explanation.

**Suggested fix:** Before calling `symbolic-ref`, check for detached HEAD explicitly: `try { branch = … symbolic-ref …; } catch { throw new Error('Cannot push: HEAD is detached. Switch to a branch first.'); }`

---

#### ⬜ LOW — assertBranchName permits leading-dot names (e.g., .foo) and .lock-suffixed names that git itself rejects

- **Location:** `packages/agent-core/src/git/ops.ts:13-18`  
- **Subsystem:** Git operations  •  **Category:** edge-case  •  **Verification:** ✅ confirmed (1/1 verifiers)


**Evidence**
```
const BRANCH_NAME = /^[A-Za-z0-9._/-]+$/;

function assertBranchName(name: string): void {
  if (!BRANCH_NAME.test(name) || name.startsWith("-") || name.includes("..")) {
    throw new Error(`Invalid branch name: ${name}`);
  }
}
```

**Why it's a bug:** The regex `^[A-Za-z0-9._/-]+$` matches a leading `.` (e.g., `.foo`) and any `.lock`-suffixed name (e.g., `feature.lock`). Both are explicitly banned by git's `check-ref-format` rules: `fatal: '.foo' is not a valid branch name` and `fatal: 'foo.lock' is not a valid branch name`. The IPC handler calls `assertBranchName` as the sole client-side guard before `git switch -c <name>`. So the guard passes, `runGit` is called, and git itself raises the error — but the user sees a raw git fatal message rather than a controlled validation error. Also `//` is accepted by the regex but rejected by git. Confirmed by running `git branch .foo` and `git branch foo.lock` on macOS git 2.49.

**Trigger / repro:** In the AirLock branch creation input, type `.hidden-branch` and confirm. `assertBranchName` passes; `git switch -c .hidden-branch` fails with git's own fatal, surfaced as an uncontrolled error to the UI.

**Suggested fix:** Extend the guard: add `|| name.startsWith('.')` and `|| name.endsWith('.lock')` to the rejection condition, and exclude `/` at position 0 (`|| name.startsWith('/')`). For full compliance, also disallow a trailing `/`, trailing `.`, and consecutive `/` sequences, or call `git check-ref-format --branch <name>` as the authoritative check.

---

#### ⬜ LOW — computeHash covers only 5 named fields; arbitrary extra top-level keys on an entry are silently accepted by verifyAuditChain

- **Location:** `packages/agent-core/src/audit/audit.ts:21-30 (computeHash) and 130-131 (verify recompute)`  
- **Subsystem:** Hash-chained audit  •  **Category:** correctness  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
function computeHash(e: Omit<AuditEntry, "hash">): string {
  const body = JSON.stringify({ ts: e.ts, actor: e.actor, op: e.op, detail: e.detail, prevHash: e.prevHash, });
  return createHash("sha256").update(body).digest("hex");
}
...
    const { hash, ...rest } = e;
    if (computeHash(rest) !== hash) return false;
```

**Why it's a bug:** computeHash reconstructs a fixed object of exactly {ts,actor,op,detail,prevHash}; any other top-level property present on a stored entry is ignored by the hash. verifyAuditChain destructures only `hash` off and recomputes over the rest, but computeHash still only reads the 5 known fields -- so an attacker who can write to the JSONL can inject arbitrary additional top-level keys into an existing entry (e.g. an `error`/`note`/`actor2` field, or a confusing duplicate) and the chain still verifies true (empirically confirmed: adding `injectedField` left verifyAuditChain === true). While this cannot rewrite the 5 covered fields, it lets a hostile writer decorate audit records with attacker-controlled, hash-unprotected data that downstream consumers (the Agent Log UI, any tooling reading the JSONL) may display or trust, undermining 'audit tampering going unnoticed'. Note this is distinct from the documented truncation limitation -- it is in-place addition, not truncation.

**Suggested fix:** Hash the entry canonically and reject unknown fields: in verifyAuditChain, after parsing, assert the entry has exactly the expected key set (ts, actor, op, detail, prevHash, hash) and fail on any extra/missing key; or compute the hash over a canonical serialization of the whole entry-minus-hash (with sorted keys) and reject if re-serialization of `rest` differs from what was stored. Also consider validating field types (actor in {user,agent}, hash/prevHash are 64-hex) so a JSON-valid but wrong-shape line is a defined integrity failure rather than relying on incidental hash mismatch.

---

#### ⬜ LOW — withDb disables TLS certificate validation (rejectUnauthorized:false) for all cloud DB connections

- **Location:** `packages/agent-core/src/db/client.ts:15-17`  
- **Subsystem:** Postgres + Neon  •  **Category:** security  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const ssl = /sslmode=require|neon\.tech|\.aws\./.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined;
```

**Why it's a bug:** Every connection matched by this regex (notably Neon and AWS-hosted Postgres) connects with certificate verification OFF. An on-path attacker can present any certificate and MITM the session, capturing the credentials and all query results -- including the password the rest of the subsystem works hard to keep main-only. Neon presents valid, publicly-trusted certs, so verification could be enabled. The code comment acknowledges this is a pragmatic v1 choice, so severity is low, but it is a standing weakening of the trust boundary and worth flagging. Secondary nit: the regex tests the whole connectionString including the password, so a password containing 'neon.tech'/'.aws.'/'sslmode=require' can flip SSL on for a non-cloud host (benign, but it shows the heuristic matches untrusted bytes).

**Trigger / repro:** Connect AirLock to any ep-*.neon.tech database on a hostile network; the pg client accepts a forged server certificate because rejectUnauthorized is false, allowing credential + data interception.

**Suggested fix:** Default to rejectUnauthorized:true with the system CA bundle (Neon/AWS RDS certs validate against public roots). If a self-signed/local TLS endpoint must be supported, gate the insecure mode behind an explicit per-secret opt-in rather than a substring heuristic over the (secret-bearing) connection string.

---

#### ⬜ LOW — importDotEnv silently drops a secret literally named __proto__ and then deletes the source .env — unreported, unrecoverable data loss

- **Location:** `packages/agent-core/src/broker/dotenv.ts:26-46`  
- **Subsystem:** Secret broker  •  **Category:** data-loss  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    ...
    out[key] = val;
  }
  return out;
```

**Why it's a bug:** parseDotEnv accumulates into a plain object literal with `out[key] = val`. For key === '__proto__', this assignment does NOT create an own enumerable property (it targets the prototype slot, and a string is silently ignored), so the entry never appears in Object.entries(pairs) inside importDotEnv. validateSecretName('__proto__') is true, so a user reasonably expects it to import. Because the dropped entry is invisible it is counted in NEITHER skipped NOR failed; if any other valid entry exists, imported.length>0 && skipped.length===0 && failed.length===0 holds, so with deleteAfter:true importDotEnv calls unlink(abs) and the source .env is destroyed — the __proto__ secret is gone from the file, never vaulted, never reported. I verified parseDotEnv('__proto__=secretval\nA=1') returns only {A:'1'} (constructor/prototype/hasOwnProperty survive normally; __proto__ is the only one swallowed). Narrow trigger, but it is exactly the deletion-on-partial-loss case the importDotEnv invariant warns against.

**Trigger / repro:** Create .env containing `__proto__=topsecret` and `A=1`; call importDotEnv(root,'.env',{deleteAfter:true}) -> result.imported=[A], skipped=[], failed=[], deleted=true; the .env (and the __proto__ value) is gone, with no record it ever existed.

**Suggested fix:** Build the parse result on a null-prototype object: `const out: Record<string,string> = Object.create(null);`, or set with `Object.defineProperty(out, key, {value: val, enumerable:true, writable:true, configurable:true})`. This makes __proto__ a normal own key so it is either vaulted or, if it later fails, recorded in failed/skipped — preventing silent loss and the unsafe delete.

---

#### ⬜ LOW — setSecret accepts empty / whitespace-only values (no rejection), unlike setGlobalSecret which throws — vaults an unusable secret and the redactor later drops whitespace-only values

- **Location:** `packages/agent-core/src/broker/broker.ts:21-51`  
- **Subsystem:** Secret broker  •  **Category:** correctness  •  **Verification:** ✅ confirmed (3/3 verifiers)


**Evidence**
```
if (!validateSecretName(name))
    throw new Error(`Invalid secret name: ${name}`);
  ...
  if (isDangerousEnvName(name))
    throw new Error(`Reserved env name cannot be vaulted: ${name}`);
  const validation = validateSecret(name, value);
  ...
  await upsertMeta(root, meta);
  keychain.set(SERVICE, await accountFor(root, name), value);
```

**Why it's a bug:** setSecret never rejects an empty or whitespace-only value — validateSecret merely returns {valid:false} (advisory, ignored on the write path) and the value is stored verbatim. Contrast setGlobalSecret (line 168) which does `if (!value) throw new Error('Empty secret value')`. So the project-scoped path is inconsistent with the global path. Concretely: a value of '   ' (spaces) is accepted and vaulted; it then gets injected into child env as a real var, yet redactSecrets/vaultedSecrets filter values whose trim() is empty (redact.ts:127, broker.ts:122 `if (v)`), so such a value is excluded from the redaction set. An empty-string value injects an empty env var and is silently excluded from inject's value (broker.ts:114-124 skips falsy). importDotEnv guards value.length===0, but the direct secrets:set IPC path does not, so a user (or an automation) can create a degenerate vault entry that behaves inconsistently across inject/redact/list.

**Trigger / repro:** setSecret(root,'BLANK','   ',{keychain}) resolves and stores '   '; later injectInto includes BLANK with value '   ' but redactSecrets([...,'   ']) drops it (trim empty), so if that value ever appears in output it is not masked. setGlobalSecret('BLANK','   ') by contrast throws /empty/.

**Suggested fix:** Mirror setGlobalSecret: in setSecret, reject before any write with `if (value.trim().length === 0) throw new Error('Empty secret value');` (or at least value.length===0 to match importDotEnv). Keeps the empty-value rule uniform across project and global stores and avoids a vaulted value that the redactor will not protect.

---

## Part B — Candidate findings pending verification (58)

_Found by the subsystem reviewers; their verifiers were killed by the session limit before voting. Treat as candidates — some may be false positives. Listed worst-case severity first._


### 🟥 CRITICAL

#### 🟥 CRITICAL — Agent escapes workspace containment: open_tab -> workspace:open sets the live agent root to ANY agent-supplied path with zero validation

- **Location:** `packages/app/src/main/ipc.ts:256-260 (workspace:open handler)`  
- **Subsystem:** IPC contract + preload bridge  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
ipcMain.handle("workspace:open", async (e, p: unknown) => {
    if (typeof p !== "string") throw new Error("Invalid payload");
    await recordAndOpen(e, p);
    return p;
  });  // recordAndOpen -> setRootForEvent(e, root) with NO existence/dir/containment check
```

**Why it's a bug:** The MCP IDE-control tool `open_tab` (mcp/tools.ts:412-418, inputSchema { path: z.string().optional() }) forwards an AGENT-controlled path through runAgentCommand -> renderer useAgentCommands.ts:55 `await window.airlock.workspaceOpen(cmd.path)` -> this handler. workspace:open only type-checks the string, then recordAndOpen() calls setRootForEvent(e, path), so the window's focused root becomes the agent-chosen path. The MCP server's getWorkspaceRoot is wired to lastFocusedRoot (index.ts:118), so EVERY subsequent agent tool (run_command cwd, git_status, database_status, the auto-spawned tab's terminal cwd, get_terminal_tail) now operates against that arbitrary directory. A malicious agent can call open_tab({path:"/Users/<user>/.ssh"}) or "/" or any path outside the project the user actually opened, then read/exfiltrate files there via its terminal. This is a full break of the workspace-confinement boundary, driven entirely by agent input. resolveRoot() carefully validates per-project handler roots against isOpenRoot, but workspace:open -- the call that ESTABLISHES roots -- has no equivalent gate, and it is now reachable from the agent.

**Trigger / repro:** Agent (over MCP) calls open_tab with path="/Users/<user>/.ssh" -> renderer workspaceOpen -> main sets window root to ~/.ssh -> agent calls run_command 'cat id_rsa' / get_terminal_tail and reads the key, all outside the opened project.

**Suggested fix:** Validate the path in workspace:open before adopting it: require it to exist and be a directory (fs.stat + isDirectory) AND, for the agent-driven path, constrain what the agent may open. Best: do not let the agent's open_tab open arbitrary absolute paths -- restrict open_tab to paths already in recentFolders / an explicit allowlist, or drop the `path` arg from the agent tool entirely (agent opens only a blank tab). At minimum, reject non-existent / non-directory paths and audit every agent-initiated workspace root change.

---

#### 🟥 CRITICAL — pty:create: stale rootForEvent re-read after async gap yields wrong project tag on sessionRoots

- **Location:** `packages/app/src/main/ipc.ts:971 and 1014`  
- **Subsystem:** PTY / host / docker / render / github / project / mcp-register  •  **Category:** race-condition  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const root = rootForEvent(e);  // line 971 — captured before async work
...
await readProjectConfig(root);  // async I/O
await injectInto(root, {});     // async keychain reads
await appendAudit(...);
...
const sr = rootForEvent(e);    // line 1014 — re-read AFTER awaits
if (sr) sessionRoots.set(s.id, sr);
```

**Why it's a bug:** workspaceRoots (the backing map for rootForEvent) is mutated synchronously by workspace:setActive. If the user switches tabs during the async secret-injection gap, rootForEvent(e) at line 1014 returns the NEW tab's root, not the one at spawn time. The terminal is spawned with cwd=root (original project) but tagged in sessionRoots with the switched project. getTerminalTail then calls allVaultedValues(root) using the WRONG project's secret list for redaction. A secret value from the original project that appears in terminal output may not be redacted because it is absent from the switched project's vault.

**Trigger / repro:** 1. Open two projects A and B as separate tabs. 2. In project A's tab, open a new terminal (pty:create fires). 3. While secret injection is awaiting (injectInto is async), quickly click project B's tab (workspace:setActive fires synchronously and mutates workspaceRoots). 4. The new terminal spawns in project A's directory but sessionRoots.get(id) === projectB_root. 5. Any terminal output containing project A secrets passes through allVaultedValues(projectB_root), which returns projectB's secrets, potentially missing projectA secrets during redaction.

**Suggested fix:** Replace the second rootForEvent(e) call at line 1014 with the already-captured root variable: change `const sr = rootForEvent(e); if (sr) sessionRoots.set(s.id, sr);` to `if (root) sessionRoots.set(s.id, root);`. The comment on line 1013 already says 'root is the same value pty:create used as the spawn cwd above' — the code should match that comment.

---

#### 🟥 CRITICAL — Vaulted MULTI-LINE secret value (PEM key, service-account JSON) is NEVER detected — core secret-leak invariant fails

- **Location:** `packages/agent-core/src/redact/scan.ts:43-49`  
- **Subsystem:** Secret-leak detection + LSP host  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    ...
    for (const s of values) {
      if (line.includes(s.value))
        add(lineNo, { kind: "vaulted", name: s.name });
```

**Why it's a bug:** The vaulted-value match is done per single line (text.split("\n") then line.includes(value)). A secret VALUE that itself contains a newline can never be a substring of any single line, so it is structurally undetectable as a vaulted leak. setSecret (broker.ts:21) accepts ANY non-empty value with no newline rejection, and SecretModal.tsx only trims the NAME, not the value (value === "" is the only check) — so multi-line secrets are fully supported and stored verbatim. The most common high-value secrets ARE multi-line: PEM/RSA/EC private keys, GCP/Firebase service-account JSON, multi-line certs/SSH keys. If the user vaults such a secret and the agent (or user) commits the literal value, scanForSecrets returns NO vaulted finding for it, the git_commit gate does NOT block, and git_status shows no leak. This is the exact false-negative the subsystem exists to prevent, on the headline 'structurally unable to leak your secrets' thesis. (PEM-shaped keys are partially saved by the generic 'pem-private-key' header pattern, but only as an anonymous pattern hit, and any non-PEM multi-line secret — service-account JSON, multi-line .env value — slips entirely.) This is the verbatim value, not an encoded/transformed form, so it is NOT covered by the documented 'encoded forms deferred' non-goal.

**Trigger / repro:** Vault a secret whose value contains a newline (e.g. a 2-line PEM private key or `{\n  "private_key": "..."\n}`). Stage a file containing that exact value. Call git_commit (gated) — it commits without blocking; git_status reports no secretLeak for it.

**Suggested fix:** Scan the whole text for multi-line values, not just per line: for values containing "\n", run a full-text indexOf over `text` and map the match offset back to a 1-indexed line (count \n before the index). Keep the per-line fast path for single-line values. Alternatively, reject newline-containing values in setSecret — but multi-line secrets are legitimate, so detection is the correct fix. Add a unit test with a vaulted value that spans two lines and assert a finding is produced.

---

#### 🟥 CRITICAL — fsWatch watcher map keyed by WebContents.id but disposed via BrowserWindow.id — watchers never closed

- **Location:** `packages/app/src/main/fsWatch.ts:29`  
- **Subsystem:** app/main core (prefs/state/activity/agent/fsWatch)  •  **Category:** resource-leak  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const id = wc.id;
```

**Why it's a bug:** syncWindowWatchers keys the watchers Map with wc.id (WebContents.id), but disposeWindowWatchers is called from window.ts with win.id (BrowserWindow.id). Per the Electron API docs, WebContents.id is 'unique among all WebContents instances' and BrowserWindow.id is 'unique among all BrowserWindow instances' — these are separate counters. The Map lookup in disposeWindowWatchers will almost never find the right entry, so every chokidar watcher created for a window is leaked when the window closes. Each leaked watcher holds a live chokidar instance and active inotify/kqueue handles for the project tree, consuming OS file-descriptor resources and CPU for every project the user opens. In a long session the process will accumulate one complete set of watchers per opened-and-closed project, unboundedly.

**Trigger / repro:** Open a project folder, then close the window (macOS: close all windows, app stays alive). Inspect process file descriptors or set a breakpoint in disposeWindowWatchers: it will call watchers.get(win.id) which returns undefined because the entry was stored under wc.id.

**Suggested fix:** In syncWindowWatchers, derive the map key from the BrowserWindow id, not the WebContents id: `const id = BrowserWindow.fromWebContents(wc)?.id; if (id === undefined) return;`. The dispose path already uses BrowserWindow.id and requires no change.

---


### 🟧 HIGH

#### 🟧 HIGH — Theme change rebuilds CodeMirror editor from original file content, discarding in-memory edits

- **Location:** `packages/app/src/renderer/src/components/EditorPane.tsx:150-292`  
- **Subsystem:** Editor / terminal / tabs components  •  **Category:** data-loss  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
}, [root, relPath, file, theme, editable, lspLang, tabId]);
```

**Why it's a bug:** The main useEffect includes `theme` in its dependency array. When the user toggles the app theme, the effect cleanup runs (calling flush() which writes the current content to disk), then tears down the EditorView, then re-creates it with `doc: file.content` (line 200) — the `file` prop value from when the file was first loaded into ProjectPane's state. The new editor instance therefore starts from the original on-disk content, not the user's in-memory edits. The flush() does save the content to disk first, so data on disk is safe, but the editor now shows the old content (before this edit session) instead of what the user just flushed. Any edits made after the last autosave fire AND before the theme toggle that have not yet been persisted by the debounce are also not in the new editor, effectively reverting the UI to the pre-edit state.

**Suggested fix:** Move theme application out of the main effect and into a separate effect that just updates the existing view's configuration, exactly like TerminalPane does for terminal theme: `useEffect(() => { if (viewRef.current) viewRef.current.dispatch({ effects: StateEffect.reconfigure.of(theme === 'dark' ? oneDark : []) }); }, [theme]);`. Remove `theme` from the main effect's dependency array. The first paint correctness is preserved by reading the theme value at EditorView construction time (same as how TerminalPane reads `useApp.getState().theme` at creation time).

---

#### 🟧 HIGH — Cross-terminal data written to wrong xterm during PTY creation race: unkeyed pending buffer accepts data from all existing PTYs

- **Location:** `packages/app/src/renderer/src/components/TerminalPane.tsx:112-141`  
- **Subsystem:** Editor / terminal / tabs components  •  **Category:** race-condition  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const offData = window.airlock.onPtyData((e) => {
      if (idRef.current === null) {
        pending.push(e.data);
        return;
      }
      if (e.id === idRef.current) writeChunk(e.data);
    });
    ...
    for (const d of pending) writeChunk(d);
```

**Why it's a bug:** Each TerminalPane subscribes to the global pty:data IPC channel (which the main process broadcasts for ALL PTYs in the window). Before `ptyCreate` resolves, `idRef.current` is null, so ALL pty:data events — including data from already-established existing terminals — are pushed into `pending` without any ID filter. When `ptyCreate` resolves, the entire `pending` array is flushed to this new terminal's xterm instance via `writeChunk(d)` with no ID validation. This means shell output from existing running terminals (prompts, command output, etc.) is rendered into the newly created terminal, and that same data is missed by the new terminal's actual PTY. The comment claims this is safe because 'each TerminalPane owns its own preload subscription' — but all subscriptions share the same broadcast channel; ownership of the subscriber does not scope the events received.

**Suggested fix:** Store the event ID alongside the data in the pending buffer: `pending.push({ id: e.id, data: e.data })`. On flush, filter by the newly adopted ID: `for (const { id, data } of pending) { if (id === idRef.current) writeChunk(data); }`. This is the minimal fix. Alternatively, since main sends the session id in every pty:data event from the moment ptyCreate is called (before the renderer's promise resolves), a single-item look-ahead approach works: subscribe after ptyCreate resolves and replay from a ring buffer held on the main side.

---

#### 🟧 HIGH — Drag-to-reorder is silently lost when the browser fires a dragleave before the drop (very common, due to child icon/text nodes)

- **Location:** `packages/app/src/renderer/src/components/FileTree.tsx:130-142 (onDragLeave/onDrop in useRowDnd)`  
- **Subsystem:** FileTree / Search / Palette / Viewer  •  **Category:** ux-bug  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const onDragLeave = () => setIndicator(null);
  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const ind = indicator;
    setIndicator(null);
    if (!dragged) return;
    if (ind === "before" || ind === "after") {
      void reorder(parent, dragged, name, ind, siblings);
    } else {
      void doMove(isDir ? relPath : parent);
    }
  };
```

**Why it's a bug:** onDrop classifies reorder-vs-move from the stored `indicator` state, but `onDragLeave` resets `indicator` to null. Each tree row contains child nodes (the `<i className="codicon">` icon and the filename text node). Browsers fire `dragleave` on the row element whenever the pointer crosses from the row into one of its children (and dragenter on the child), so a real drag that finishes while hovering over the icon/text — the normal case — arrives at `drop` with `indicator === null`. The drop then takes the `else` branch (move) instead of reorder. For a same-folder reorder, `doMove(parent)` is a no-op (canDropInto returns false because the item is already in that folder), so the user's reorder gesture does NOTHING; for a cross-context drag it can misroute to a move. The existing reorder.test.tsx fires dragOver->drop with no intervening dragleave, so it never exercises this path.

**Trigger / repro:** Drag file a.ts and release it over the bottom edge of sibling b.ts but with the pointer physically over b.ts's filename text (so the browser emitted a dragleave on the row as the pointer entered the text node just before mouseup). Expected: order becomes [b.ts, a.ts]. Actual: nothing changes (setFileOrder never called). Confirmed with a probe test: firing dragStart->dragOver(after band)->dragLeave->drop yields 0 setFileOrder and 0 moveFile calls.

**Suggested fix:** Do not trust the stale `indicator` in onDrop. Recompute the zone from the drop event itself: in onDrop, recompute `const sibling = parentOf(dragged) === parent; const z = dropZone(e.currentTarget.getBoundingClientRect(), e.clientY, isDir);` and branch on (sibling && (z===before||z===after)) -> reorder, else -> move — mirroring onDragOver. Alternatively guard onDragLeave with `e.relatedTarget` containment (only clear when actually leaving the row, not entering a descendant).

---

#### 🟧 HIGH — Deleted/rotated secret still in the PTY ring buffer is returned UN-redacted to the agent (get_terminal_tail / list_terminals redaction keyed on CURRENT vault only)

- **Location:** `packages/app/src/main/ipc.ts:1099-1101 (allVaultedValues) used by getTerminalTail 1130-1131 and listTerminals 1146/1155`  
- **Subsystem:** IPC contract + preload bridge  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
async function allVaultedValues(root: string): Promise<string[]> {
  return (await vaultedSecrets(root)).map((s) => s.value);
}
...
  const values = await allVaultedValues(root);
  const tail = redactedTail(raw, values, n);
```

**Why it's a bug:** ptyBuffers retains up to TAIL_CAP (256 KB) of RAW terminal output per session. Redaction (redactedTail/redactedPreview) only masks the value strings it is handed, and those come from allVaultedValues(root) = vaultedSecrets(root) = secrets that are CURRENTLY in the vault. If a secret value was printed into the terminal (e.g. an injected env var echoed by a tool, a crash dump, `echo $API_KEY`) and the user then DELETES that secret (secrets:delete) or ROTATES it via secrets:set to a new value, the old value is still in the ring buffer but is no longer in allVaultedValues, so redactSecrets never masks it. The agent's get_terminal_tail MCP tool then returns the raw old secret value -- a direct secret-value-to-agent leak, which is the exact invariant the product is built on. The pure redaction helpers (terminal/tail.test.ts, redact.test.ts) are tested only with explicitly-passed value arrays, and tools.test.ts mocks getTerminalTail entirely, so this caller-side gap is uncovered.

**Trigger / repro:** injectSecretsIntoTerminal on; a tool prints the secret into the shell; user deletes that secret in the Secrets panel; agent calls get_terminal_tail -> raw secret value returned because it is no longer in the live vault list.

**Suggested fix:** Decouple buffer redaction from current vault membership. Either (a) maintain a main-side set of every secret value ever vaulted for the root (including deleted/old values) and redact against that union, (b) redact at WRITE time into ptyBuffers (mask known secret values as data is tee'd in) so a later deletion cannot un-mask history, or (c) clear/scrub the relevant ring buffers when a secret is deleted or rotated. Option (b) is the most robust: once redacted into the buffer, history stays safe regardless of vault changes.

---

#### 🟧 HIGH — MCP bearer token exposed in process argument list via execFile argv

- **Location:** `packages/agent-core/src/mcp/register.ts:49-62`  
- **Subsystem:** PTY / host / docker / render / github / project / mcp-register  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const args = [
  "mcp",
  "add",
  "--transport",
  "http",
  name,
  input.url,
  "--scope",
  scope,
  "--header",
  `Authorization: Bearer ${input.token}`,
];
await run(args, input.cwd ?? process.cwd());
```

**Why it's a bug:** execFile passes all elements of args as the child process's argv. On macOS, ps -ef lists the full command line of every process; on Linux, /proc/PID/cmdline is world-readable by default when hidepid is not set. The bearer token—which guards the MCP server and authorises every agent tool call including get_terminal_tail, run_command, and request_secret—appears verbatim in the process table for the duration of the claude CLI invocation. Any local user who polls ps during that window obtains a valid credential to call the MCP server.

**Trigger / repro:** During app startup or re-registration, run `ps -ef | grep claude` from another terminal on the same machine. The output will contain `--header Authorization: Bearer <token>`, which can then be used in a crafted HTTP request to http://127.0.0.1:<port>/mcp to call any MCP tool.

**Suggested fix:** Pass the Authorization header to the claude CLI via an environment variable (if the CLI supports it, e.g., CLAUDE_MCP_HEADER) or write the configuration to a temp file with restricted permissions and pass --config to claude. Alternatively, use a pipe/stdin approach so the header value never appears in argv. As a minimum mitigation, restrict the file permissions on the MCP config so that the persistent token is not readable by other users.

---

#### 🟧 HIGH — pty:input / pty:resize / pty:kill missing window-ownership check allows cross-window terminal injection

- **Location:** `packages/app/src/main/ipc.ts:1058-1086`  
- **Subsystem:** PTY / host / docker / render / github / project / mcp-register  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
ipcMain.on("pty:input", (_e, payload: unknown) => {
  if (!payload || typeof payload !== "object") return;
  const { id, data } = payload as { id: string; data: string };
  if (typeof id === "string" && typeof data === "string")
    sessions.get(id)?.write(data);
});

ipcMain.on("pty:resize", (_e, payload: unknown) => { ... sessions.get(id)?.resize(cols, rows); });
ipcMain.on("pty:kill", (_e, id: unknown) => { ... sessions.get(id)?.kill(); });
```

**Why it's a bug:** The sender event is discarded (_e, not e) in all three handlers. In contrast, pty:isBusy (line 1050) and getTerminalTail (line 1118) correctly check sessionWindows.get(id) against the sender's BrowserWindow id before acting. The invariant stated in the module (lines 108-109) is that 'a window only ever sees + reads its OWN terminals', but write/resize/kill have no such guard. A renderer that knows another terminal's UUID — reachable e.g. via a compromised renderer process, XSS in displayed file content, or an attacker-controlled agent message — can write arbitrary data to, resize, or kill any terminal from any window.

**Trigger / repro:** From a renderer process, call window.airlock.ptyInput(knownTerminalId, 'malicious command\r') where knownTerminalId belongs to a terminal in a different BrowserWindow. Main processes the write against the global sessions Map with no ownership check. The command executes in the victim terminal.

**Suggested fix:** Add the same window-ownership guard that pty:isBusy uses to all three fire-and-forget handlers:
```
ipcMain.on('pty:input', (e, payload) => {
  ...
  const ownerId = BrowserWindow.fromWebContents(e.sender)?.id;
  if (ownerId !== undefined && sessionWindows.get(id) !== ownerId) return;
  sessions.get(id)?.write(data);
});
```
Apply the same pattern to pty:resize and pty:kill, replacing _e with e.

---

#### 🟧 HIGH — restartActiveTerminal: inverted guard leaves tab empty when sole terminal is restarted

- **Location:** `packages/app/src/renderer/src/lib/restartActiveTerminal.ts:19-21`  
- **Subsystem:** Renderer lib + hooks  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const after = useApp.getState().tabTerminals[tid];
  if (after && after.terminals.length > 0) s.addTerminal(tid);
```

**Why it's a bug:** When the tab has exactly one terminal (the common case after opening a folder), `removeTerminal` drops it leaving `after.terminals.length === 0`. The guard `length > 0` is then false, so `addTerminal` is never called. The tab is left with zero terminals — the user cannot type and the secret-injection-via-restart flow silently fails. The only test covers a two-terminal tab (kills one sibling, keeps the other), so the single-terminal case is never exercised.

**Trigger / repro:** Open a folder, have exactly one terminal, press 'Restart Terminal' in the Secrets section (SecretsSection.tsx line 189). The active terminal is killed but no new terminal is created; the tab is left empty.

**Suggested fix:** Remove the guard entirely or invert it to always spawn a replacement: `if (after) s.addTerminal(tid);` — or simply call `s.addTerminal(tid)` unconditionally. The goal is 'kill and replace', so a fresh terminal should always be spawned.

---

#### 🟧 HIGH — fillActiveTab drops the blank tab's terminal split (and any open files), losing a live coexisting pane

- **Location:** `packages/app/src/renderer/src/store.ts:625-653`  
- **Subsystem:** Renderer store (zustand)  •  **Category:** data-loss  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const state: ProjectState = {
  ...freshProjectState(root),
  mainTabOrder: survivors.map((t) => ({ kind: "terminal" as const, id: t.id })),
  current: activeId ? { kind: "terminal", id: activeId } : null,
};
```

**Why it's a bug:** fillActiveTab intentionally keeps the blank tab's terminals alive (tabTerminals[id] is NOT reset), but it rebuilds ProjectState from freshProjectState(root) which has splits:[] and editorTabs:[], then only restores mainTabOrder/current. If the user split the blank tab's terminals before attaching a folder (MainTabs.splitWithNewTerminal -> splitItems(current,newTerm) writes tabState[blank].splits=[[t1,t2]]), that split pair is silently DROPPED on attach. The two terminals survive as live ptys (still mounted) but the scene collapses to a single pane: deriveView([], current) yields mainSecondary=null, so the second terminal vanishes from screen even though its pty keeps running. The existing test (store.test.ts:1102) only covers the survivors-in-mainTabOrder case, NOT a pre-existing terminal split, so this is uncovered. The split model is explicitly a multi-split scene that 'showing one tab never destroys another's split' — dropping it on a folder-attach violates that invariant and loses the user's layout.

**Trigger / repro:** Open a blank tab, add a terminal, click 'Split with a new terminal' (now [t1|t2] split showing), then open a folder into that blank tab. The second terminal pane disappears from the scene though its shell is still alive.

**Suggested fix:** Carry the surviving terminals' scene forward: keep cur.splits filtered to pairs whose members are all surviving terminals (drop any file-referencing pairs since editorTabs is reset), e.g. const keptSplits = (cur?.splits ?? []).filter(p => p[0].kind==='terminal' && p[1].kind==='terminal' && survIds.has(p[0].id) && survIds.has(p[1].id)); then build state via setView-style derivation with those splits instead of freshProjectState's empty splits.

---

#### 🟧 HIGH — replaceActiveProject leaves a stale project-level split pointing at the replaced tab, showing a dead second pane

- **Location:** `packages/app/src/renderer/src/store.ts:658-672`  
- **Subsystem:** Renderer store (zustand)  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
replaceActiveProject: (root) => {
  set((s) => {
    const id = s.activeTabId;
    const state = freshProjectState(root);
    return {
      tabs: s.tabs.map((t) => (t.id === id ? { id, root } : t)),
      tabState: { ...s.tabState, [id]: state },
      tabTerminals: { ...s.tabTerminals, [id]: emptyTabTerminals() },
      ...mirrorOf(state),
      modal: null,
    };
  });
```

**Why it's a bug:** In windows-mode, replaceActiveProject swaps the active tab's root in place but never clears the project-level `split` ({a,b}). If the active tab was a member of a showing split (e.g. split={a:active,b:other}), after replacement isVisibleTab still reports both as visible and the layout still renders a 2-pane project split — left pane is now a completely different project, right pane is the unrelated `other` tab. The plan states 'closeTab also clears splitTabId if it closed the split pane', but the analogous replace path was missed. Worse, replaceActiveProject also resets tabTerminals[id] to empty, so the ProjectTerminals respawn effect must refill it, while the OTHER pane keeps showing a stale project the user thought they navigated away from. No test covers replaceActiveProject while a project split is showing.

**Trigger / repro:** Windows mode (openProjectsAsTabs=false), open /a then split it with /b (split showing). Use Open Folder to replace /a with /c. The split stays on screen with /c on the left and /b on the right instead of collapsing to the single replaced project.

**Suggested fix:** In replaceActiveProject, dissolve the split if the active tab is a member: const split = s.split && (s.split.a===id || s.split.b===id) ? null : s.split; and return it in the set. Same guard fillActiveTab should apply.

---

#### 🟧 HIGH — Crashed typescript-language-server is never reaped or restarted — all LSP dead until the root is closed/reopened

- **Location:** `packages/app/src/main/lsp/client.ts:79-140 (startServer/ensure); only proc.on present is 'error' at 89`  
- **Subsystem:** Secret-leak detection + LSP host  •  **Category:** resource-leak  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
proc.on("error", (err) => console.error("[lsp] spawn failed", err));
  ...
function ensure(root: string): Server {
  let s = servers.get(root);
  if (!s) {
    s = startServer(root);
    servers.set(root, s);
  }
  return s;
}
```

**Why it's a bug:** There is NO proc.on("exit")/proc.on("close") and NO conn.onClose handler. servers.delete(root) happens ONLY inside disposeServer(), which is driven exclusively by window/root lifecycle (syncLspServers / disposeAllLspServers). tsserver crashes in practice (OOM on a large project, segfault, OS kill). When it dies, the dead Server stays in the `servers` map forever. ensure(root) keeps returning the dead entry; its `ready` promise already resolved (the initialize .catch at 126 swallows failure and returns undefined, so `await s.ready` never rejects), so hover/completion/definition proceed against a closed connection and silently return null/[] (their requests reject and are caught), and didChange/didClose call sendNotification on a closed writer (which can throw into the renderer's fire-and-forget call). Net effect: a single tsserver crash permanently disables ALL LSP features (diagnostics, hover, completion, go-to-definition) for that workspace with no recovery short of closing and reopening the folder. The zombie process is also never re-cleaned.

**Trigger / repro:** Open a TS file (spawns tsserver). Kill the tsserver child externally (or it OOMs). Trigger hover/definition/edit — nothing works and no new server is spawned; the dead entry persists in `servers`.

**Suggested fix:** In startServer, register proc.on("exit")/conn.onClose to remove the entry: `const drop = () => { if (servers.get(root) === s) servers.delete(root); }; proc.on("exit", drop); proc.on("close", drop); conn.onClose(drop);`. So the next ensure() respawns a fresh server. Optionally add a small restart backoff to avoid a crash-loop storm. Also make initialize failure reject `ready` (or mark the server unhealthy) so a half-dead server is not treated as ready.

---

#### 🟧 HIGH — Human 'advisory' commit is NOT fail-open — a scan/keychain error blocks the human's commit (spec says never block the human)

- **Location:** `packages/app/src/main/secrets/commit.ts:13-18`  
- **Subsystem:** Secret-leak detection + LSP host  •  **Category:** error-handling  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const leaks = await scanStaged(root);
  if (opts.gated && leaks.length > 0 && !opts.confirm) {
    return { committed: false, sha: null, blocked: true, leaks };
  }
  const sha = await commitStaged(root, message);
```

**Why it's a bug:** scanStaged(root) runs BEFORE commitStaged and is not wrapped in try/catch here, nor in the renderer IPC handler (ipc.ts:641-644 calls guardedCommit(..., { gated: false }) raw, and ipcMain.handle has no global error wrapper). scanStaged -> scanFiles -> vaultedSecrets reads the OS keychain (getSecretValue per entry); a locked keychain or any transient keychain/git error makes vaultedSecrets/scanStaged throw, and that rejection propagates out of guardedCommit, so commitStaged is NEVER reached and the human's commit fails. This directly violates the approved design's Error-handling section: 'A scan that throws (read error, etc.) is logged and treated as no findings (fail-open) ... a scanner bug must never break committing' and Decision 1 'The HUMAN is never blocked'. The fail-open is not implemented anywhere. (The gated/agent path at tools.ts:259-266 at least catches and returns err(), so the agent sees an error rather than a crash — but it also doesn't fall back to committing.)

**Trigger / repro:** Lock the OS keychain (or stub getSecretValue to throw). From the GitSection, commit staged changes via git:commit -> guardedCommit rejects -> the human's commit fails entirely instead of committing with no advisory.

**Suggested fix:** Wrap the scan so a scan failure degrades to no-findings on the advisory path: `let leaks: SecretLeak[] = []; try { leaks = await scanStaged(root); } catch (e) { console.error('[secrets] scan failed', e); leaks = []; }` then proceed. For the gated path, the spec notes fail-closed (require confirm) is acceptable future hardening — but the advisory/human path MUST be fail-open. Add a test where scanStaged rejects and assert the advisory commit still succeeds.

---

#### 🟧 HIGH — SecretsSection shows stale plaintext after secret update via modal

- **Location:** `packages/app/src/renderer/src/components/SecretsSection.tsx:17, 51-62, 139-141`  
- **Subsystem:** Sidebar sections  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const [revealed, setRevealed] = useState<Record<string, string>>({});
// ...
const toggleReveal = async (name: string) => {
  // ...
  const value = await window.airlock.secretsReveal(root, name);
  setRevealed((r) => ({ ...r, [name]: value ?? "(not found)" }));
};
// ...
{revealed[s.name] !== undefined && (
  <div className="secret-reveal">{revealed[s.name]}</div>
)}
```

**Why it's a bug:** When the user reveals a secret's plaintext (stores it in local `revealed` state), then opens SecretModal to UPDATE that same secret, SecretModal.submit() on success calls `setSecrets(await secretsList(root))` (updating the store list) but never calls any method that would reset SecretsSection's local `revealed` map. `setRevealed({})` is only invoked inside `refresh()`, which runs only on `root` change or `removeSecret`. After a successful update, the old plaintext value remains displayed in the sidebar next to the updated secret's row. The user believes they've changed the secret, but the old value is still on screen.

**Trigger / repro:** 1. Open a project with a secret. 2. In the Secrets sidebar, click the eye icon to reveal its value (e.g. 'old_value'). 3. Click the secret name to open the Update modal. 4. Enter a new value ('new_value') and click Save. 5. The modal closes but the sidebar still shows 'old_value' in the reveal panel.

**Suggested fix:** In `SecretsSection`, add a `useEffect` that clears `revealed` whenever the `secrets` array reference changes: `useEffect(() => { setRevealed({}); }, [secrets]);`. Alternatively, after `setSecrets` is called in `SecretModal`, clear the reveals by storing a version counter in the store and having `SecretsSection` react to it.

---

#### 🟧 HIGH — pty:input, pty:resize, pty:kill do not verify the sender owns the target session

- **Location:** `packages/app/src/main/ipc.ts:1058-1086`  
- **Subsystem:** app/main core (prefs/state/activity/agent/fsWatch)  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
ipcMain.on("pty:input", (_e, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { id, data } = payload as { id: string; data: string };
    if (typeof id === "string" && typeof data === "string")
      sessions.get(id)?.write(data);
  });

  ipcMain.on("pty:kill", (_e, id: unknown) => {
    if (typeof id !== "string") return;
    sessions.get(id)?.kill();
  });
```

**Why it's a bug:** pty:create records the owning BrowserWindow id in sessionWindows and pty:isBusy correctly validates ownership before responding. However, pty:input (write arbitrary bytes to a PTY), pty:resize, and pty:kill use _e (ignore the sender) and perform no sessionWindows.get(id) ownership check. A compromised renderer window — or a second window in a multi-window session — can enumerate any session id (or guess it) and write arbitrary input into another window's terminal, including a running `claude` session, or kill it. In a multi-project setup this is a cross-project terminal hijack.

**Trigger / repro:** Create two windows. In window A, open a project and start a terminal (session S). From window B's renderer (via executeJavaScript or a second tab), send ipcRenderer.send('pty:input', { id: S, data: 'rm -rf ...' }). The command executes in window A's terminal.

**Suggested fix:** Add the same ownership guard as pty:isBusy to all three handlers: resolve `const ownerId = BrowserWindow.fromWebContents(e.sender)?.id` and return early if `ownerId === undefined || sessionWindows.get(id) !== ownerId`.

---

#### 🟧 HIGH — fs:writeFile missing assertNotVault — renderer can overwrite .airlock/ vault metadata

- **Location:** `packages/app/src/main/ipc.ts:342-349`  
- **Subsystem:** app/main core (prefs/state/activity/agent/fsWatch)  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
ipcMain.handle(
    "fs:writeFile",
    (e, root: unknown, relPath: unknown, content: unknown) => {
      if (typeof relPath !== "string" || typeof content !== "string")
        throw new Error("Invalid payload");
      return writeWorkspaceFile(resolveRoot(e, root), relPath, content);
    },
  );
```

**Why it's a bug:** Every other write-mutation IPC handler (fs:create, fs:mkdir, fs:move, fs:duplicate, fs:trash, fs:openExternalFile, fs:readImage) calls assertNotVault(relPath) to prevent touching the .airlock vault directory. fs:writeFile does not. writeWorkspaceFile in agent-core only calls resolveWithin (path-traversal guard), NOT targetsVault. A renderer can therefore write an arbitrary-content .airlock/secrets.json, injecting fake secret metadata entries or corrupting the audit chain.

**Trigger / repro:** From the renderer, invoke ipcRenderer.invoke('fs:writeFile', root, '.airlock/secrets.json', '{}') — this overwrites the vault metadata with an empty object, wiping all secret registrations.

**Suggested fix:** Add `assertNotVault(relPath);` immediately after the `typeof` checks, matching every other write handler.

---

#### 🟧 HIGH — savePrefs has an unguarded read-modify-write race — concurrent saves silently clobber each other

- **Location:** `packages/app/src/main/prefs.ts:167-180`  
- **Subsystem:** app/main core (prefs/state/activity/agent/fsWatch)  •  **Category:** race-condition  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
export async function savePrefs(
  file: string,
  patch: Partial<AppPrefs>,
): Promise<AppPrefs> {
  const next = sanitize({ ...(await loadPrefs(file)), ...patch });
  ...
  await rename(tmp, file);
  return next;
}
```

**Why it's a bug:** savePrefs does a load-then-write with an await between them and no locking. Multiple concurrent callers — e.g. two simultaneous workspace:open events (the user opens two tabs in quick succession using cmd-T twice), prefs:set racing with sections:set, or agentPolicy:set racing with recordAndOpen — will each read the same old snapshot, compute independent next states, then last-writer-wins. The earlier writer's update is silently lost. Concretely: opening two recent folders in rapid succession can cause one of them to disappear from recentFolders.

**Trigger / repro:** Call `Promise.all([savePrefs(f, {theme:'light'}), savePrefs(f, {sidebarPosition:'right'})])` — one update will be lost because both callers read the same original file before either write commits.

**Suggested fix:** Serialize writes with a module-level promise chain (a write queue): `let _queue = Promise.resolve(); function savePrefs(...) { _queue = _queue.then(() => doSave(...)); return _queue; }` so concurrent callers are ordered rather than racy.

---

#### 🟧 HIGH — runAgentCommand: TOCTOU between win.isDestroyed() check and win.webContents.send() call

- **Location:** `packages/app/src/main/agent-commands.ts:45-56`  
- **Subsystem:** app/main core (prefs/state/activity/agent/fsWatch)  •  **Category:** error-handling  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
if (!win || win.isDestroyed()) {
    return Promise.resolve({ ok: false, error: "No airlock window" });
  }
  const id = randomUUID();
  return new Promise<AgentCommandResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: "timed out" });
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    win.webContents.send("agent:command", { id, cmd });
  });
```

**Why it's a bug:** The guard at line 45-48 checks win.isDestroyed() but the actual send at line 56 is on win.webContents (a different object). If the window is destroyed between the guard and the send (e.g. the user closes the window while the MCP tool is dispatching), win.webContents.send() will throw 'Cannot call send on a destroyed webContents', which is an unhandled exception that propagates out of the Promise constructor as an uncaught rejection, crashing the MCP tool call and potentially leaving a stranded pending entry. Additionally, even if win is checked, win.webContents itself is not checked for isDestroyed().

**Trigger / repro:** Start an IDE-control MCP tool call (e.g. list_tabs). Between the guard check and the send, close the last window. The MCP call hangs until the 5-second timeout fires, then the next tool call may see 'Cannot call send on destroyed webContents' as an uncaught exception.

**Suggested fix:** Wrap the send in a try/catch inside the Promise constructor and resolve { ok:false, error } on throw; also check win.webContents.isDestroyed() before calling send.

---


### 🟨 MEDIUM

#### 🟨 MEDIUM — EditorPane cleanup flush failure silently loses the user's last edit with no retry path

- **Location:** `packages/app/src/renderer/src/components/EditorPane.tsx:161-176, 285-291`  
- **Subsystem:** Editor / terminal / tabs components  •  **Category:** data-loss  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const flush = (): void => {
      ...
      void window.airlock
        .writeFile(root, relPath, view.state.doc.toString())
        .then(() => setSaveState('saved'))
        .catch((err) => {
          console.error('autosave failed', err);
          dirty = true; // retry on the next edit or flush
          setSaveState('unsaved');
        });
    };
    ...
    return () => {
      flush(); // flush before the editor goes away
```

**Why it's a bug:** When the editor unmounts (file switch, tab close, theme change, root change), `flush()` is called in the cleanup. If `writeFile` fails (disk full, IPC error, file locked), the `.catch()` sets `dirty = true` on the closed closure and calls `setSaveState('unsaved')` on an unmounted component. Both are no-ops at that point: the component is gone, `dirty` lives in a garbage-collected closure, and `setSaveState` is called on an unmounted component. There is no retry and no user-visible notification — the edit is permanently lost. This is particularly harmful on file switch (a frequent operation) where a write error during the cleanup flush causes the user to lose their last edits.

**Suggested fix:** In the cleanup flush, on error, persist the pending content somewhere that survives the component's lifetime (e.g., a separate in-memory queue, or a sessionStorage entry keyed by root+path) and attempt a retry from that queue, or at minimum show a window-level error notification so the user knows to manually re-enter the content. A simpler approach: use `window.airlock.writeFile` synchronously if possible, or at minimum expose the flush result to the caller (e.g., via a promise) so the file-close path can wait for it.

---

#### 🟨 MEDIUM — closeOtherFiles in MainTabs uses getState() inside render (outside effect/callback) violating React rendering rules

- **Location:** `packages/app/src/renderer/src/components/MainTabs.tsx:111-116`  
- **Subsystem:** Editor / terminal / tabs components  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const closeOtherFiles = async (keepPath: string) => {
    if (selectedFile !== keepPath) await openEditorFile(tabId, keepPath);
    for (const p of useApp.getState().tabState[tabId]?.editorTabs ?? []) {
      if (p !== keepPath) useApp.getState().closeEditorTab(p, tabId);
    }
  };
```

**Why it's a bug:** This async function is used as a click-handler callback. The `for..of` loop calls `useApp.getState()` on every iteration to both read `editorTabs` and call `closeEditorTab`. Since `closeEditorTab` mutates the store's `editorTabs` array on each call, subsequent iterations of the loop read a fresh `editorTabs` snapshot via `getState()` — which has already had the previous tabs removed. If `closeEditorTab` for tab A causes a state update that removes tab B from the list before the loop reaches B, B will not be in the next `getState().tabState[tabId]?.editorTabs` and will not be closed. In practice, Zustand's `set` is synchronous and the state IS updated immediately, so the loop reads the shrinking list on each call. Because it reads the snapshot at the top of each iteration after mutations, the set of tabs to close is correct. However, this is fragile: if `closeEditorTab` internally uses async operations, tabs could be skipped. Currently `closeEditorTab` is synchronous in the store, so this works but is not robust.

**Suggested fix:** Capture the list of tabs to close before the loop: `const tabsToClose = (useApp.getState().tabState[tabId]?.editorTabs ?? []).filter(p => p !== keepPath); for (const p of tabsToClose) useApp.getState().closeEditorTab(p, tabId);`. This eliminates the dependency on mutation-order semantics.

---

#### 🟨 MEDIUM — EditorPane sends lspDidOpen with original file.content but lspDidClose is not awaited in cleanup — LSP server may process open/close out of order on rapid file switch

- **Location:** `packages/app/src/renderer/src/components/EditorPane.tsx:275-292`  
- **Subsystem:** Editor / terminal / tabs components  •  **Category:** ipc-contract  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
if (lspLang) {
      void window.airlock.lspDidOpen(
        root,
        relPath,
        lspLang,
        lspVersion,
        file.content,
      );
    }
    return () => {
      flush();
      if (lspTimer) clearTimeout(lspTimer);
      if (lspLang) void window.airlock.lspDidClose(root, relPath);
      view.destroy();
      viewRef.current = null;
    };
  }, [root, relPath, file, theme, editable, lspLang, tabId]);
```

**Why it's a bug:** Both `lspDidOpen` and `lspDidClose` are fire-and-forget (`void`). On a rapid file switch (e.g., clicking quickly through multiple files), the cleanup of instance N fires `lspDidClose` and the new instance N+1 fires `lspDidOpen` for the same file — but both are async IPC calls. If `lspDidOpen` from N+1 reaches the language server before `lspDidClose` from N, the server receives an open for a file it thinks is already open, which is a protocol violation. The LSP spec requires didClose before didOpen for the same URI. Under high latency or rapid switching, this ordering is not guaranteed.

**Suggested fix:** Await `lspDidClose` before the cleanup returns (or before the next effect fires `lspDidOpen`). Since effect cleanups are synchronous, the practical fix is to queue the close before the open: pass a `closedPromise` ref that the cleanup sets, and in the effect body await it before calling `lspDidOpen`. Alternatively, sequence the calls on the main side by serializing all LSP requests per file URI.

---

#### 🟨 MEDIUM — Search match highlight length follows the live input box, not the query that produced the results

- **Location:** `packages/app/src/renderer/src/components/SearchPanel.tsx:111-115 (Preview len={query.trim().length})`  
- **Subsystem:** FileTree / Search / Palette / Viewer  •  **Category:** ux-bug  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
<Preview
                      text={m.preview}
                      col={m.col}
                      len={query.trim().length}
                    />
```

**Why it's a bug:** Results are stored against the query that was actually run (setSearchResults(q, results) on Enter), but the bold span length is derived from `query` — the live, uncommitted input value. After running a search the user can keep typing without pressing Enter; the displayed rows are still from the old query, yet the highlighted span grows/shrinks to the new input length, bolding the wrong number of characters (and starting at a `col` that no longer corresponds to the highlighted text). The match length should come from the searched query (search?.query) not the input box. Search is plain substring, so the correct highlight length is exactly the searched query's length.

**Trigger / repro:** Confirmed with a probe: search 'abc' on a line 'abcdefghij' -> bold span is 'abc'. Then edit the input to 'abcdefgh' WITHOUT pressing Enter -> the same result row now bolds 'abcdefgh' (8 chars) even though it is still the result for 'abc'.

**Suggested fix:** Highlight against the committed query: `len={(search?.query.trim().length) ?? 0}` (and use search?.query, not the live `query` state, for the highlight). Keep the live `query` only for the input value and run().

---

#### 🟨 MEDIUM — fs:writeFile is the only mutating fs handler missing the assertNotVault guard -- renderer can overwrite/clobber .airlock vault metadata + audit chain

- **Location:** `packages/app/src/main/ipc.ts:342-349 (fs:writeFile handler)`  
- **Subsystem:** IPC contract + preload bridge  •  **Category:** data-loss  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
ipcMain.handle(
    "fs:writeFile",
    (e, root: unknown, relPath: unknown, content: unknown) => {
      if (typeof relPath !== "string" || typeof content !== "string")
        throw new Error("Invalid payload");
      return writeWorkspaceFile(resolveRoot(e, root), relPath, content);
    },
  );  // no assertNotVault(relPath)
```

**Why it's a bug:** Every other mutating fs handler -- fs:create, fs:mkdir, fs:move, fs:duplicate, fs:trash, fs:readImage, fs:openExternalFile -- calls assertNotVault(relPath) as defense in depth, and the AirlockApi doc comments (shared/ipc.ts:311,316) explicitly promise 'The .airlock vault dir is rejected by the handlers'. fs:writeFile omits it. writeWorkspaceFile only does resolveWithin(root, relPath), which PERMITS paths inside root including .airlock/. node:fs writeFile creates-or-truncates, so a renderer call writeFile(root, '.airlock/secrets.json', '...') or writeFile(root, '.airlock/audit.jsonl', '') silently corrupts/erases the vault metadata index and the audit chain -- the integrity backbone of the secret broker. The FileTree never surfaces .airlock, but the IPC channel is directly callable.

**Trigger / repro:** From the renderer: window.airlock.writeFile(root, '.airlock/secrets.json', '{}') -> overwrites the vault metadata index; or '.airlock/audit.jsonl','' -> truncates the audit log.

**Suggested fix:** Add `assertNotVault(relPath);` to the fs:writeFile handler (line ~346), exactly as the sibling mutating handlers do.

---

#### 🟨 MEDIUM — pty:input / pty:resize / pty:kill have no window/session ownership check -- a renderer can write to, resize, or kill ANY window's terminal by id

- **Location:** `packages/app/src/main/ipc.ts:1058-1086 (pty:input / pty:resize / pty:kill)`  
- **Subsystem:** IPC contract + preload bridge  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
ipcMain.on("pty:input", (_e, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { id, data } = payload as { id: string; data: string };
    if (typeof id === "string" && typeof data === "string")
      sessions.get(id)?.write(data);
  });  // no sessionWindows.get(id) === sender-window check
...
ipcMain.on("pty:kill", (_e, id: unknown) => {
    if (typeof id !== "string") return;
    sessions.get(id)?.kill();
  });
```

**Why it's a bug:** These three handlers look up sessions.get(id) with NO check that the calling webContents owns that session. By contrast pty:isBusy (1047-1056) explicitly enforces `if (sessionWindows.get(id) !== ownerId) return false`, and getTerminalTail/listTerminals enforce window+root scoping -- precisely because terminals are meant to be scoped to their owning window. A compromised/hostile renderer in window A that learns or guesses a session id from window B can: inject arbitrary shell input into B's terminal (pty:input), including a terminal that has secrets injected into its env (e.g. send commands that act on $API_KEY), kill the user's running process (pty:kill, e.g. a live `claude` or dev server), or resize/disrupt it. Output of the injected commands is delivered to B's owning webContents (captured at create), so this is primarily cross-window command injection / tampering / DoS rather than direct exfil to the attacker, but it still breaks the per-window terminal isolation the rest of the subsystem enforces.

**Trigger / repro:** Renderer in window A: window.airlock.ptyInput('<window-B-session-id>', 'rm -rf important\n') or ptyKill('<window-B-session-id>') -- main routes it to B's pty with no ownership check.

**Suggested fix:** Mirror pty:isBusy: in each of pty:input/pty:resize/pty:kill, resolve the sender's BrowserWindow id and `return` early unless sessionWindows.get(id) === senderWindowId, so a window can only drive its own sessions.

---

#### 🟨 MEDIUM — run_command output redaction does not cover baseEnv / process.env values — ambient shell secrets leak via `env`/`printenv`

- **Location:** `packages/agent-core/src/command/run.ts:137-149 (env build + redact); baseEnv source packages/app/src/main/index.ts:119 + pty/login-env.ts:29`  
- **Subsystem:** MCP IDE-bridge server  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const env = {
  ...(process.env as Record<string, string>),
  ...(opts.baseEnv ?? {}),          // <-- getBaseEnv() = captureLoginEnv() = FULL login-shell env
  ...injectedEnv,
};
const res = await runner.run(command, { cwd: opts.cwd ?? root, env, ... });
const combined = res.stderr ? `${res.stdout}\n${res.stderr}` : res.stdout;
const output = redactSecrets(combined, values);   // `values` = ONLY the vault-injected secrets; baseEnv/process.env values are NOT in this set
```

**Why it's a bug:** The run-command design says the child env should be a 'safe base env (real PATH etc.)' but the implementation spreads the ENTIRE captured login-shell environment (captureLoginEnv runs `$SHELL -ilc env` and keeps every exported variable — a very common home for OPENAI_API_KEY / GITHUB_TOKEN / AWS_SECRET_ACCESS_KEY exported from .zshrc/.zprofile) PLUS all of main's process.env. redactSecrets is only given the vault-injected `values`, so run_command("env") or run_command("printenv OPENAI_API_KEY") returns those ambient secrets to the agent verbatim. The tool's own description promises 'the output is returned with secret values redacted' / 'You never see the secret value', which this path violates for any secret living in the user's shell env. (Nuance: these are the user's ambient vars, not the vault, and the agent's own spawned Bash terminal likely has the same env — so this is a redaction-scope/spec gap rather than a vault breach; hence medium not critical.)

**Trigger / repro:** Add `export OPENAI_API_KEY=sk-abc123` to ~/.zshrc, open AirLock, have the agent call run_command({ command: "printenv OPENAI_API_KEY" }). Output returns `sk-abc123` unredacted.

**Suggested fix:** Either curate baseEnv down to the spec's 'safe base env' (PATH, locale, a small allowlist) before injecting, or extend redactSecrets' value set to also include the values of every env var present in the child env that is not a known-innocent name. Minimally, stop spreading full process.env + full loginEnv into the agent-facing runner; align with the spec's 'safe base env' wording.

---

#### 🟨 MEDIUM — parseRunList and parseRunJobs throw SyntaxError on non-JSON gh output, violating their declared return type

- **Location:** `packages/agent-core/src/github/ci.ts:50-57 (parseRunList), 70-92 (parseRunJobs)`  
- **Subsystem:** PTY / host / docker / render / github / project / mcp-register  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
export function parseRunList(raw: string): RunListEntry | null {
  const text = raw.trim();
  if (!text) return null;
  const arr = JSON.parse(text) as RunListEntry[];  // throws SyntaxError on non-JSON
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[0] ?? null;
}

export function parseRunJobs(raw: string): { steps: CiStep[]; stepsDone: number; stepsTotal: number } {
  const text = raw.trim();
  if (!text) return { steps: [], stepsDone: 0, stepsTotal: 0 };
  const payload = JSON.parse(text) as JobsPayload;  // throws SyntaxError on non-JSON
  ...
}
```

**Why it's a bug:** Both functions' TypeScript return types promise a value-or-null result — never a throw. But both call JSON.parse without a try/catch. When gh prepends a non-JSON prefix (e.g., 'A new release of gh is available: 2.x.x -> 2.y.y', or a stderr warning mixed into stdout on some gh versions), JSON.parse throws a SyntaxError. The call site in latestCiRun (lines 127, 138) has no try/catch around either call, so the SyntaxError propagates. It is only silenced by the outer catch {} in activityStatus — which is incidental, not contractual. Any future caller of the exported functions gets an undocumented throw.

**Trigger / repro:** Call parseRunList('A new release of gh is available.\n[{...}]') — the JSON.parse of the full string throws SyntaxError instead of returning null. The existing test suite only covers empty strings and well-formed JSON.

**Suggested fix:** Wrap both JSON.parse calls in try/catch and return the null/empty value on failure:
```ts
try {
  const arr = JSON.parse(text) as RunListEntry[];
  ...
} catch {
  return null;
}
```
Do the same in parseRunJobs (return the empty-steps sentinel). This makes the functions' behaviour match their declared return types and removes the dependency on callers providing catch blocks.

---

#### 🟨 MEDIUM — captureLoginEnv: env values with embedded newlines corrupt subsequent env-var parsing

- **Location:** `packages/agent-core/src/pty/login-env.ts:39-45`  
- **Subsystem:** PTY / host / docker / render / github / project / mcp-register  •  **Category:** edge-case  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const { stdout } = await exec(shell, ["-ilc", "env"], { ... });
const out: Record<string, string> = {};
for (const line of stdout.split("\n")) {
  const eq = line.indexOf("=");
  if (eq <= 0) continue;
  const key = line.slice(0, eq);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
  out[key] = line.slice(eq + 1);
}
```

**Why it's a bug:** The comment on line 34 acknowledges that 'env -0 would be ideal but not all shells expose it; use newline-split and accept that values with embedded newlines are rare in env.' However, on macOS and Linux it is common for TERMINFO_DIRS, LS_COLORS, or user-set vars like PROMPT_COMMAND or PS1 to contain literal newlines. When such a value is split on '\n', its continuation line is parsed as a new candidate key. If the continuation matches the key regex (e.g., a value whose second line starts with 'SOME_NAME=...'), a spurious env var is injected into baseEnv and then spread into every PTY's environment as process.env floor. This can silently overwrite legitimate vars or inject adversarial ones into child processes.

**Trigger / repro:** Set an env var with a newline: `export MY_VAR=$'line1\nPATH=attacker_controlled'`. Run captureLoginEnv(). The returned object will contain both `MY_VAR: 'line1'` and `PATH: 'attacker_controlled'`, even though PATH was already correct.

**Suggested fix:** Use `env -0` (NUL-delimited) when the shell supports it — zsh, bash, and most POSIX shells do. Spawn the shell as `exec(shell, ['-ilc', 'env -0'])` and split stdout on '\0' instead of '\n'. This is immune to newlines in values. Keep the current newline-split as a fallback (catch the case where env -0 fails or returns empty).

---

#### 🟨 MEDIUM — openPickedFolder: addTerminal() drops tabId after async gap, terminal lands in wrong tab

- **Location:** `packages/app/src/renderer/src/lib/openFolder.ts:25`  
- **Subsystem:** Renderer lib + hooks  •  **Category:** race-condition  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const busy = prevPty ? await window.airlock.ptyIsBusy(prevPty) : false;

  s.setRoot(root); // blank active -> fillActiveTab (keeps the existing terminals)
  const newTermId = s.addTerminal(); // fresh folder-rooted terminal, now active
```

**Why it's a bug:** After the `await window.airlock.ptyIsBusy(prevPty)` call, the user could have clicked a different tab. `activeId` was captured before the await (line 11), but `s.addTerminal()` is called with no `tabId` argument. Inside `addTerminal`, the store updater does `const tid = tabId ?? s.activeTabId` — using the *current* `activeTabId`, which may now be a different tab. The new folder-rooted terminal then appears in the wrong tab, and `s.setRunningNotice({ terminalId: newTermId })` points at a terminal in that wrong tab, corrupting the notice state.

**Trigger / repro:** Open AirLock with a blank tab and a running terminal, open a folder while quickly clicking a different tab between the folder picker dialog closing and the ptyIsBusy check completing. The new terminal appears in the tab the user switched to instead of the blank tab that was being populated.

**Suggested fix:** Pass `activeId` explicitly: `const newTermId = s.addTerminal(activeId);`. `activeId` is captured before the await and is the correct target regardless of subsequent tab switches.

---

#### 🟨 MEDIUM — commands.ts: open-file / close-editor / split-view use stale `s.activeTabId` from palette-build snapshot

- **Location:** `packages/app/src/renderer/src/lib/commands.ts:44-47, 76-82, 61-70`  
- **Subsystem:** Renderer lib + hooks  •  **Category:** race-condition  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
run: async () => {
        const rel = await window.airlock.openFile();
        if (rel) await openEditorFile(s.activeTabId, rel);
      },
...
      run: async () => {
        if (s.diff) s.setDiff(null);
        else if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.dbView) s.setDbView(null);
        else if (s.selectedFile)
          await closeEditorFile(s.activeTabId, s.selectedFile);
      },
```

**Why it's a bug:** `buildCommands` captures `s = AppState` once at palette-open time. The `run` closures close over this snapshot. `s.activeTabId`, `s.selectedFile`, `s.diff`, and `s.settingsOpen` can all become stale: (1) `open-file` waits for the OS file picker dialog (several seconds), during which the user could switch tabs — the file is then opened in the *original* tab, not where the user is looking. (2) `close-editor` checks stale `s.diff`/`s.settingsOpen`/`s.dbView`; if a diff is opened after the snapshot, `closeEditorFile` fires instead of `setDiff(null)`. The split-view command likewise uses stale `s.current` and `s.activeTabId`.

**Trigger / repro:** Open the command palette, select 'Open File', switch to a different tab while the system file picker is open, choose a file — the file opens in the tab that was active when the palette was opened, not the currently focused tab.

**Suggested fix:** Read live state inside `run()` instead of relying on the captured snapshot: `const live = useApp.getState(); if (live.diff) live.setDiff(null); ...` and `await openEditorFile(useApp.getState().activeTabId, rel);`.

---

#### 🟨 MEDIUM — closeEditorFile neighbor-activation races with closeEditorTab, can leave focus on a wrong/closed file in a split

- **Location:** `packages/app/src/renderer/src/lib/editorFiles.ts:26-37`  
- **Subsystem:** Renderer store (zustand)  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
if (cur.selectedFile === relPath) {
  const idx = cur.editorTabs.indexOf(relPath);
  const neighbor = cur.editorTabs[idx + 1] ?? cur.editorTabs[idx - 1] ?? null;
  if (neighbor) await openEditorFile(tabId, neighbor);
}
useApp.getState().closeEditorTab(relPath, tabId);
```

**Why it's a bug:** closeEditorFile decides the neighbor from cur.selectedFile (the file ON SCREEN = left-if-file else right-if-file, per deriveView). When the closed file is the SECONDARY pane of a split (selectedFile resolves to it because the primary is a terminal), this branch fires, awaits openEditorFile(neighbor) which calls store.openFile(neighbor) — that sets current=neighbor ALONE and (because openFile passes cur.splits unchanged) the split containing the about-to-be-closed file still exists pointing at it. Then closeEditorTab(relPath) runs but cur.current is now the neighbor (not the closed file), so its 'if current === closed' fallback is skipped and it only drops the split via dropFromSplits. Net effect after the two-step is a focus jump to a neighbor that was never part of the split, and an intermediate render where the doomed file is still a live split member. Because openEditorFile is async (awaits readFile IPC) any state change between the two calls (another close, a rename) operates on stale indices. closeEditorTab already has its own correct partner-fallback; the extra neighbor pre-activation in closeEditorFile is redundant and order-fragile.

**Trigger / repro:** Open a.ts and b.ts, split a terminal with b.ts (terminal|b.ts), then click X on b.ts's tab. Focus lands on a.ts (a neighbor that was never beside the terminal) rather than the terminal, and the close is two renders instead of one.

**Suggested fix:** Let store.closeEditorTab own the fallback (it already computes partner ?? mainTabOrder[0]); drop the pre-activation in closeEditorFile, or compute the neighbor synchronously and pass it so there is a single atomic set() rather than an awaited two-step.

---

#### 🟨 MEDIUM — removeTerminal / closeEditorTab focus fallback to mainTabOrder[0] can yank the user into an unrelated coexisting split

- **Location:** `packages/app/src/renderer/src/store.ts:1118-1124`  
- **Subsystem:** Renderer store (zustand)  •  **Category:** ux-bug  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const current =
  cur.current && samePaneItem(cur.current, killed)
    ? (partner ?? mainTabOrder[0] ?? null)
    : cur.current;
return setView(sAfterKill, tabId, splits, current, { mainTabOrder });
```

**Why it's a bug:** When the focused single pane is closed and it had no split partner, the fallback is mainTabOrder[0]. With the multi-split scene model there can be OTHER coexisting splits in the same tab. If mainTabOrder[0] happens to be a member of a different split pair, setView -> shownScene finds that pair and SHOWS it — so closing one terminal abruptly reveals a 2-pane split the user wasn't looking at, instead of falling back to the most-recent single pane. Same logic in closeEditorTab (line 956-959). Not data loss, but a focus/scene surprise that the scene model's 'showing one never disturbs another' intent argues against. Tests only exercise fallback when no other split exists.

**Trigger / repro:** In one tab: split [a.ts|b.ts] (coexisting), then open terminal t3 alone and focus it. Kill t3. Instead of falling back to a single pane, the view jumps to the [a.ts|b.ts] split because a.ts is mainTabOrder[0].

**Suggested fix:** Prefer a non-split sibling for the fallback: pick the last mainTabOrder entry that is not a member of any remaining split (or the killed item's prior neighbor in mainTabOrder) before defaulting to mainTabOrder[0], so closing a single pane doesn't expand an unrelated split.

---

#### 🟨 MEDIUM — splitItems with a===b creates a self-pair, producing a split that renders the same pane twice / blank second column

- **Location:** `packages/app/src/renderer/src/store.ts:997-1027`  
- **Subsystem:** Renderer store (zustand)  •  **Category:** edge-case  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
splitItems: (a, b, tabId) =>
  set((s) => {
    ...
    const splits: [PaneItem, PaneItem][] = [
      ...dropFromSplits(dropFromSplits(cur.splits, a), b),
      [a, b],
    ];
    ...
    const without = base.filter((it) => !samePaneItem(it, b));
    const ai = without.findIndex((it) => samePaneItem(it, a));
```

**Why it's a bug:** splitItems never guards a===b. The terminal-removal code explicitly notes 'the same terminal must never occupy both slots — that leaves a blank second column' (removeFromTab, line 521-524), but splitItems has no such guard. MainTabs.splitPrimaryWith protects the click path (it allocates a fresh terminal when samePaneItem(current,item)), but splitItems is a public store action also reachable from splitWithNewTerminal and any future/agent caller. With a===b: dropFromSplits removes a (==b) so prior pairs vanish, then [a,a] is pushed; `without` filters out b(==a) so `a` is removed from the order, ai becomes -1, and the order-rebuild appends [a,a]. shownScene returns {left:a,right:a} and deriveView sets activeTerminalId/selectedFile to the same item — the UI renders the identical pane in both columns (terminal) or a duplicate file editor. For a terminal this is two xterm hosts bound to one id.

**Trigger / repro:** Call useApp.getState().splitItems({kind:'terminal',id:'t1'},{kind:'terminal',id:'t1'}). splits becomes [[t1,t1]] and mainSecondary===mainPrimary terminal t1 — the same terminal shown in both split columns.

**Suggested fix:** Early-guard in splitItems: if (samePaneItem(a,b)) return viewItem-equivalent (focus a alone) — i.e. fall through to setView(s,tid,dropFromSplits(cur.splits,a),a,...) without creating a [a,a] pair.

---

#### 🟨 MEDIUM — typescript-language-server child processes are not killed on app quit (disposeAllLspServers is dead code)

- **Location:** `packages/app/src/main/lsp/client.ts:306-308 (disposeAllLspServers) + index.ts:175-186 before-quit handlers`  
- **Subsystem:** Secret-leak detection + LSP host  •  **Category:** resource-leak  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
export function disposeAllLspServers(): void {
  for (const root of [...servers.keys()]) disposeServer(root);
}
// index.ts before-quit handlers: killAllSessions; stopMcpServer(); unregisterMcpServer({scope:'user'}) -- no LSP disposal
```

**Why it's a bug:** disposeAllLspServers has ZERO callers (confirmed by grep) — it is dead code. The app's before-quit handlers kill PTY sessions and stop the MCP server but never tear down LSP children. On a hard quit (Cmd-Q / menu Quit), 'before-quit' fires but window 'closed' events that drive syncLspServers may not all run before the process exits, so spawned `node`/tsserver children (one per workspace root, each holding a TS project in memory) can be orphaned. Over repeated open/quit cycles this leaks long-lived processes and memory. (The non-darwin window-all-closed -> app.quit() path is partly mitigated because each window 'closed' handler runs syncLspServers(allOpenRoots()), but that relies on every window closing gracefully first and does nothing for a direct app.quit().)

**Trigger / repro:** Open a TS workspace, then Cmd-Q. Inspect processes — the typescript-language-server child (electron running cli.mjs via ELECTRON_RUN_AS_NODE) can remain after the app exits.

**Suggested fix:** Wire disposeAllLspServers into the quit path: `app.on('before-quit', disposeAllLspServers);` in main/index.ts (alongside killAllSessions). disposeServer already sends exit + dispose + proc.kill().

---

#### 🟨 MEDIUM — SecretModal does not refresh secrets list when saved secret fails validation

- **Location:** `packages/app/src/renderer/src/components/SecretModal.tsx:95-99`  
- **Subsystem:** Sidebar sections  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
if (!meta.valid) {
  setError(
    "Saved, but the value looks unusual for this name. Check the provider hint.",
  );
} else {
  setSecrets(await window.airlock.secretsList(root));
  setModal(null);
  ...
}
```

**Why it's a bug:** When `secretsSet` succeeds but returns `meta.valid === false`, the secret IS written to the keychain but `setSecrets` is never called, so the sidebar's secrets list stays stale. In 'add-secret' mode the newly added secret does not appear in the sidebar at all. The user sees 'Saved, but …' and may close the modal via Cancel — Cancel does call `setSecrets`, but only as a side-effect of dismissal. If the user submits again with a different name, a second secret is created without the first ever appearing in the list. The count in StatusBar is also wrong until then.

**Trigger / repro:** 1. Open a project with no secrets. 2. Add a secret with a name like 'FOO' (not a COMMON_NAME) and enter an invalid-looking value. The provider validator returns meta.valid=false. 3. The error 'Saved, but …' appears. 4. Check the sidebar — the secret does not appear even though it is in the keychain.

**Suggested fix:** In the `!meta.valid` branch, call `setSecrets(await window.airlock.secretsList(root))` before showing the error so the list stays consistent:
```
if (!meta.valid) {
  setSecrets(await window.airlock.secretsList(root));
  setError('Saved, but the value looks unusual…');
}
```

---

#### 🟨 MEDIUM — DatabasesSection: in-flight dbList/dbTables response lands on wrong project after tab root changes

- **Location:** `packages/app/src/renderer/src/components/DatabasesSection.tsx:20-47, 55-69`  
- **Subsystem:** Sidebar sections  •  **Category:** race-condition  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const refresh = useCallback(async () => {
  if (!root) return;
  setBusy(true);
  try {
    const list = await window.airlock.dbList(root);
    setDbs(list);  // no mount guard
    setPings(...);
    setTables({});
    setExpanded({});
    await Promise.all(list.map(async (d) => {
      const r = await window.airlock.dbPing(root, d.id);
      setPings((p) => ({ ...p, [d.id]: r.ok ? 'ok' : 'fail' }));
    }));
  ...
}, [root]);

// toggle() also:
const t = await window.airlock.dbTables(root, id);
setTables((m) => ({ ...m, [id]: t }));
```

**Why it's a bug:** Unlike `NeonSection` and `LocalHostSection`, `DatabasesSection` has no `mounted.current` guard or abort mechanism. If the user changes the project folder for the tab (openFolder while the section is visible) while an in-flight `dbList` or `dbTables` IPC call is pending, the response from the OLD root will call `setDbs`, `setPings`, or `setTables` on the component now bound to the NEW root, populating it with the previous project's database entries. This also applies to `toggle`'s `dbTables` call which captures `root` from the render closure.

**Trigger / repro:** 1. Open a project with slow-to-respond databases. 2. Expand the Databases section so `refresh()` / `ping` calls are in flight. 3. Immediately open a different project folder in the same tab. 4. The in-flight responses arrive and overwrite the new project's (empty) database view with the old project's DBs.

**Suggested fix:** Add a `mounted` ref (like `NeonSection`) or use an incrementing `version` counter that is captured in the closure and checked after each `await`; bail out (do not call setters) if the version has advanced. Alternatively, check `root` has not changed after each `await`: capture it at function start and compare.

---

#### 🟨 MEDIUM — Window close while secret-request is pending leaves pending map blocked for 5 minutes

- **Location:** `packages/app/src/main/agent-requests.ts:63-76`  
- **Subsystem:** app/main core (prefs/state/activity/agent/fsWatch)  •  **Category:** resource-leak  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
if (pending.size > 0) return Promise.resolve({ vaulted: false, busy: true });
  ...
  if (!notify({ requestId, name, providerHint })) {
    return Promise.resolve({ vaulted: false });
  }
  return new Promise<SecretRequestResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ vaulted: false, timedOut: true });
    }, REQUEST_TIMEOUT_MS);  // 5 minutes
    pending.set(requestId, { resolve, timer });
```

**Why it's a bug:** If the modal is sent to a window (notify returns true) and the user then closes that window before saving or cancelling, there is no window-closed handler to call resolveSecretRequest. The pending entry stays in the map for up to REQUEST_TIMEOUT_MS (5 minutes). Any subsequent agent request_secret call during that window sees pending.size > 0 and returns {busy:true} immediately, making the secret-request feature unavailable for 5 minutes after any window close while a modal is active.

**Trigger / repro:** 1. Trigger a request_secret MCP call (opens modal). 2. Before clicking save/cancel in the modal, close the AirLock window. 3. Trigger another request_secret call — it returns {busy:true} and the busy state persists for 5 minutes.

**Suggested fix:** Listen to the BrowserWindow 'closed' event (or a window-tracking mechanism) and for each pending request whose target window has closed, call resolveSecretRequest(requestId, false) immediately to unblock the pending map.

---

#### 🟨 MEDIUM — recordAndOpen passes stale prev.sectionVisibility to applyAppMenu after a concurrent prefs change

- **Location:** `packages/app/src/main/ipc.ts:227-245`  
- **Subsystem:** app/main core (prefs/state/activity/agent/fsWatch)  •  **Category:** race-condition  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
async function recordAndOpen(
    e: { sender: Electron.WebContents },
    root: string,
  ): Promise<void> {
    setRootForEvent(e, root);
    const prev = await loadPrefs(prefsFile);
    const recents = [
      root,
      ...prev.recentFolders.filter((p) => p !== root),
    ].slice(0, RECENT_CAP);
    await savePrefs(prefsFile, { recentFolders: recents });
    applyAppMenu(
      prefsFile,
      prev.sectionVisibility,  // <-- stale snapshot
      recents,
      prev.openProjectsAsTabs,
    );
```

**Why it's a bug:** recordAndOpen captures prev = loadPrefs() then awaits savePrefs. If the user changes a sidebar section visibility (sections:set -> changeSectionVisibility -> savePrefs) concurrently between those two awaits, applyAppMenu is called with the old sectionVisibility, reverting the menu's checkmarks to the pre-change state. The menu and the actual prefs.json are now out of sync until the next prefs reload.

**Trigger / repro:** Simultaneously open a recent project and toggle a sidebar section via the View menu. The section checkmark reverts to its old state in the menu while the actual persisted value is correct.

**Suggested fix:** After savePrefs returns, re-read the prefs for the menu rebuild: `const latest = await loadPrefs(prefsFile); applyAppMenu(prefsFile, latest.sectionVisibility, recents, latest.openProjectsAsTabs);`

---


### ⬜ LOW

#### ⬜ LOW — slotRef callback in ProjectPane returns a cleanup function from useCallback but React 19 cleanup protocol requires the callback to not conditionally return

- **Location:** `packages/app/src/renderer/src/components/ProjectPane.tsx:95-102`  
- **Subsystem:** Editor / terminal / tabs components  •  **Category:** resource-leak  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const slotRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      register(tabId, el);
      return () => unregister(tabId, el);
    },
    [tabId, register, unregister],
  );
```

**Why it's a bug:** React 19 introduced cleanup return values from ref callbacks. The pattern is correct when the callback ALWAYS returns a cleanup function. However, this callback conditionally returns `undefined` (when `el` is null) or a cleanup function. In React 19's new protocol, when a ref callback returns a cleanup, React no longer calls the callback with null on cleanup — it calls the returned cleanup function instead. But the `if (!el) return;` guard is for the legacy null-call protocol. In practice, React 19 will either call the cleanup (never calling with null) or call with null if something goes wrong. The dual protocol creates a risk: if React ever calls the callback with null (fallback/legacy path), `register` is not called but `unregister` was also never registered, which is harmless. More critically, if `tabId` or `register`/`unregister` change identity (causing `useCallback` to produce a new function), the old callback's cleanup is `undefined` (since it returned `undefined` for the null case in older React), potentially leaving the stale slot registered. The `unregister` implementation guards against this (checks `prev[tabId] !== el`), so this is low severity.

**Suggested fix:** Use the React 19 cleanup-return pattern cleanly: `const slotRef = useCallback((el: HTMLDivElement | null) => { if (!el) { unregister(tabId, null!); return; } register(tabId, el); return () => unregister(tabId, el); }, [tabId, register, unregister]);` — or, since `useCallback` deps include `tabId`, restructure to avoid the dual protocol by using `useRef` for the slot and calling register/unregister in a `useEffect` instead.

---

#### ⬜ LOW — ResizeObserver fit.fit() called after TerminalPane unmount if the debounce timer fires between ro.disconnect() and timer clearance

- **Location:** `packages/app/src/renderer/src/components/TerminalPane.tsx:161-170, 173-186`  
- **Subsystem:** Editor / terminal / tabs components  •  **Category:** resource-leak  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      input.dispose();
      title.dispose();
      offData();
      offExit();
      if (idRef.current && !exited) window.airlock.ptyKill(idRef.current);
      term.dispose();
      ...
    };
```

**Why it's a bug:** The cleanup correctly cancels `resizeTimer` and disconnects the `ResizeObserver`. However, there is a subtle ordering issue: `clearTimeout(resizeTimer)` is called BEFORE `ro.disconnect()`. If a new ResizeObserver callback fires between when the old timer was cleared and when `ro.disconnect()` completes (in theory impossible in the synchronous JS event loop, but relevant if the ResizeObserver microtask queue flushes during cleanup), a new `resizeTimer` could be set on a disconnected observer. In practice, because JS is single-threaded and cleanup runs synchronously, a new ResizeObserver callback cannot interleave. The real concern is that `resizeTimer` is set inside the callback closure, not via `let resizeTimer` reassignment visible to cleanup. Since both the ResizeObserver callback and the cleanup share the same `resizeTimer` variable via closure, `clearTimeout` will cancel the right timer. This is a low-risk theoretical issue, not a real bug, but worth noting that `ro.disconnect()` should come before `clearTimeout` to be strictly correct.

**Suggested fix:** Reorder cleanup to call `ro.disconnect()` before `clearTimeout(resizeTimer)` to ensure no new ResizeObserver callbacks can set the timer after it is cleared. This is already almost correct; the current code just has the order slightly off.

---

#### ⬜ LOW — TerminalPane working-indicator scan runs forever on orphaned intervals if TerminalPane re-mounts rapidly (StrictMode double-invoke)

- **Location:** `packages/app/src/renderer/src/components/TerminalPane.tsx:216-242`  
- **Subsystem:** Editor / terminal / tabs components  •  **Category:** resource-leak  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
useEffect(() => {
    const SCAN_MS = 600;
    const timer = setInterval(() => {
      ...
    }, SCAN_MS);
    return () => clearInterval(timer);
  }, []);
```

**Why it's a bug:** The scan interval effect has an empty dependency array and a correct `clearInterval` cleanup. In React StrictMode (development) effects are deliberately double-invoked (mount, unmount, remount) to surface cleanup bugs. The empty-deps interval is re-created on the remount and the old one is cleaned up — this is correct. However, since `termRef.current` and `idRef.current` are shared refs between the PTY lifecycle effect and this scan effect, there is a window during the StrictMode second mount where `termRef.current` holds the old (destroyed) Terminal instance before the PTY lifecycle effect re-creates it. The scan's `if (!term || !ptyId) return;` guard skips the destroyed terminal correctly (idRef.current is null after cleanup). This is not a bug in production (StrictMode is dev-only), but it means the scan correctly handles ref races. Not a real bug — included for completeness.

**Suggested fix:** No fix needed. The current design is intentionally resilient: refs are null-checked before use, and the interval's cleanup is correct.

---

#### ⬜ LOW — Palette fuzzy-match highlight misaligns on filenames containing astral (non-BMP) characters

- **Location:** `packages/app/src/renderer/src/components/Palette.tsx:12-27 (Highlight) + lib/fuzzy.ts:32-41`  
- **Subsystem:** FileTree / Search / Palette / Viewer  •  **Category:** edge-case  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
function Highlight({ text, indices }: { text: string; indices: number[] }) {
  const set = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <b key={i}>{ch}</b>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
```

**Why it's a bug:** fuzzyScore iterates with `for (let ti = 0; ti < t.length; ti++)` and pushes `ti` — these are UTF-16 code-unit indices. Highlight renders with `[...text].map((ch, i) => set.has(i))`, where the spread iterates by Unicode code POINT, so `i` is a code-point index. For any string containing a surrogate pair (emoji, some CJK extension chars) the two index spaces diverge by 1 per astral char before the match, so the wrong character — or no character — gets bolded. Filenames legitimately can contain emoji.

**Trigger / repro:** Confirmed with a probe: fuzzyScore('a', '🎉a') returns indices [2] (code units), but [...'🎉a'] has length 2 (valid indices 0,1). Highlight checks set.has(0/1), never set.has(2), so the matched 'a' is NOT bolded; with more astral chars before the match the WRONG char bolds.

**Suggested fix:** Make the two consistent: either iterate by code unit in Highlight (`text.split('').map(...)`/index by code unit, matching fuzzyScore), or compute fuzzyScore indices over `[...text]` code points. Simplest: index Highlight by code unit so it matches fuzzyScore's index space.

---

#### ⬜ LOW — Palette file-list cache (module-level Map) grows unbounded across an editing session

- **Location:** `packages/app/src/renderer/src/components/Palette.tsx:9, 64-86 (fileCache)`  
- **Subsystem:** FileTree / Search / Palette / Viewer  •  **Category:** resource-leak  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const fileCache = new Map<string, { files: string[]; truncated: boolean }>();
...
    const cacheKey = `${root} ${fsVersion}`;
    const cached = fileCache.get(cacheKey);
    if (cached) { setFiles(cached); return; }
    ...
        fileCache.set(cacheKey, r);
```

**Why it's a bug:** The cache is keyed by `${root} ${fsVersion}` and is only ever written (.set), never evicted. fsVersion is bumped by the fs:changed watcher (useFsWatch -> bumpFsVersion) on every file create/delete/move/save. Each bump produces a brand-new cache key while every previous key remains, each holding the project's full flat file-path list. Over a long session with many edits this is unbounded memory growth that survives palette open/close (module scope).

**Trigger / repro:** Open a project, open the palette once (caches root@v0), then make N file edits/saves (watcher bumps fsVersion to N). fileCache now holds N+1 entries for that root, each the full file list; none are released.

**Suggested fix:** Evict stale entries: before set(), delete other keys for the same root (keep only the current fsVersion), or cap the Map size (LRU), or key only by root and clear that root's entry on fsVersion change.

---

#### ⬜ LOW — Renaming/moving a folder orphans its saved custom file order (and descendants'), silently losing the ordering

- **Location:** `packages/app/src/renderer/src/components/FileTree.tsx:475-482 (doRename) / 509-520 (doMove)`  
- **Subsystem:** FileTree / Search / Palette / Viewer  •  **Category:** data-loss  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const doRename = async (relPath: string, newName: string) => {
    if (!root) return;
    const slash = relPath.lastIndexOf("/");
    const parent = slash >= 0 ? relPath.slice(0, slash) : ".";
    const toRel = join(parent, newName);
    await window.airlock.moveFile(root, relPath, toRel);
    renameFilePath(relPath, toRel, tabId); // keep open editors at the new path
  };
```

**Why it's a bug:** fileOrder is keyed by folderRel (store.fileOrder[root][folderRel]). On a folder rename/move, only open editor tab paths are rebased (renameFilePath); the fileOrder map keys are never rebased. After the watcher re-lists, the renamed folder has no matching key, so applyOrder falls back to default sort and the user's manual ordering for that folder and every subfolder under it is lost. The old keys also linger (in memory and in the committed .airlock-order.json) as dead entries. Note: this is also the parent folder's own ordering of the renamed entry — that one survives because applyOrder drops unknown names and re-appends the new name at the end, which itself reorders the parent unexpectedly.

**Trigger / repro:** Customize the order inside folder src (drag to reorder a couple files). Rename src -> lib. Reopen lib: files are back in default A-Z order; the custom order is gone. The store still holds fileOrder[root]['src'].

**Suggested fix:** When renaming/moving a folder, rebase the fileOrder map: for every key equal to fromRel or starting with `${fromRel}/`, move it to toRel + remainder, and persist (setFileOrder for the new key, clear the old). Do this alongside renameFilePath.

---

#### ⬜ LOW — host:probe is an unauthenticated renderer-driven port prober against arbitrary host:port (weak SSRF primitive)

- **Location:** `packages/app/src/main/ipc.ts:925-935 (host:probe handler)`  
- **Subsystem:** IPC contract + preload bridge  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
ipcMain.handle("host:probe", async (_e, url: unknown) => {
    if (typeof url !== "string") throw new Error("Invalid payload");
    let u: URL;
    try { u = new URL(url); } catch { return { up: false }; }
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { up: await probePort(u.hostname, port) };
  });
```

**Why it's a bug:** Unlike host:openExternal (which guards /^https?:\/\//), host:probe accepts any URL with any scheme/host/port and performs a TCP connect to the parsed hostname:port, returning a boolean reachability. This lets the renderer port-scan localhost, the LAN, or cloud metadata endpoints (169.254.169.254) and infer which internal services are up. It returns only a boolean (no response body), and it is a UI-only channel (no MCP tool), so impact is limited to reconnaissance, but it is still an over-broad primitive on the trust boundary.

**Trigger / repro:** Renderer: window.airlock.hostProbe('http://169.254.169.254:80') or iterate ports on 127.0.0.1 -> boolean up/down reveals running internal services.

**Suggested fix:** Constrain probe targets to the intended dev-server use case: restrict to localhost / 127.0.0.1 / ::1 (and the project's configured devUrl host), reject other hostnames and link-local/metadata ranges, and require http(s) scheme like host:openExternal does.

---

#### ⬜ LOW — Bearer-token check uses non-constant-time string comparison

- **Location:** `packages/app/src/main/mcp/server.ts:212-216`  
- **Subsystem:** MCP IDE-bridge server  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
if (req.headers.authorization !== `Bearer ${token}`) {
  res.statusCode = 401;
  res.end("unauthorized");
  return;
}
```

**Why it's a bug:** The bearer token is the sole authorization boundary for a tool surface that runs shell commands and injects vaulted secrets (the spec: 'requires a bearer token ... so only the user's Claude (not an arbitrary local process) can call airlock's tools'), and the audit brief lists a constant-time compare as part of the invariant. JS `!==` on strings short-circuits at the first differing byte, which is a classic timing oracle on the secret. The practical risk is low here — the listener is loopback-only (the attacker must already be a local process), the token is 192 bits of hex, and Node's HTTP/stream stack adds large timing jitter that swamps the per-byte signal — but it is a genuine deviation from constant-time handling of the auth secret and is cheap to fix.

**Suggested fix:** Compare with crypto.timingSafeEqual over equal-length Buffers (guard the length first, e.g. build both buffers, bail to 401 if lengths differ, else timingSafeEqual). Keeps the fail-closed behavior while removing the per-byte timing dependence on the token.

---

#### ⬜ LOW — commands.ts toggle-section commands close over stale `visible` flag

- **Location:** `packages/app/src/renderer/src/lib/commands.ts:119-128`  
- **Subsystem:** Renderer lib + hooks  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
for (const sec of SECTIONS) {
    const visible = s.sectionVisibility[sec.id];
    cmds.push({
      id: `toggle-section-${sec.id}`,
      title: `Toggle ${sec.label} Section`,
      run: () => {
        void window.airlock.setSectionVisibility(sec.id, !visible);
      },
    });
  }
```

**Why it's a bug:** `visible` is captured from the `s` snapshot when `buildCommands` is called (palette open). If `onSectionsChanged` fires between palette open and command execution (e.g., user right-clicks → toggles a section via the menu while the palette is still visible), `visible` is stale. The command then flips the section to the opposite of what the snapshot said, which may be the *same* state it is already in — toggling becomes a no-op instead of a flip.

**Trigger / repro:** Toggle a sidebar section via right-click so it becomes hidden; without closing that context menu, open the command palette. The snapshot sees `visible = true` (before toggle). Execute the section toggle command. It calls `setSectionVisibility(sec.id, false)` — but the section is already hidden. The toggle is a no-op instead of re-showing it.

**Suggested fix:** Read live state inside `run()`: `run: () => { const cur = useApp.getState().sectionVisibility[sec.id]; void window.airlock.setSectionVisibility(sec.id, !cur); }`.

---

#### ⬜ LOW — workingIndicator: regex matches unrelated terminal messages containing 'esc to inter'

- **Location:** `packages/app/src/renderer/src/lib/workingIndicator.ts:19, 23-25`  
- **Subsystem:** Renderer lib + hooks  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const WORKING_INDICATOR = /esc to inter/i;

export function hasWorkingIndicator(terminalText: string): boolean {
  return WORKING_INDICATOR.test(terminalText.replace(/\s+/g, " "));
}
```

**Why it's a bug:** The regex matches any occurrence of `esc to inter` (case-insensitive), not specifically Claude's 'esc to interrupt' footer. Any shell or CLI that prints a help/keybinding line containing 'esc to interpret', 'esc to interrogate', 'esc to intercept', etc. will cause the per-tab status dot to show 'working' and block the tab-glow 'finished' signal. The test suite covers idle strings but does not test strings like 'esc to interpret' which also match.

**Trigger / repro:** Run a program in a terminal that prints a keybinding hint such as 'press esc to interpret' (e.g., a custom REPL). The status dot turns yellow even though Claude is not running.

**Suggested fix:** Use a more specific pattern: `/esc to interrupt/i` is the full intended match (wide terminal). To also handle truncation, anchor the prefix more tightly and combine: `/esc to interr/i` (7 chars, covers 'interru...' but not 'interpret'). Or test for the full phrase and fall back: `/(esc to interrupt|esc to interr[^e])/i`.

---

#### ⬜ LOW — reveal signal is never cleared after consumption, so a tab close + reopen with the same path/line silently fails to scroll

- **Location:** `packages/app/src/renderer/src/store.ts:1232-1236`  
- **Subsystem:** Renderer store (zustand)  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
reveal: null,
revealLine: (tabId, path, line) =>
  set((s) => ({
    reveal: { tabId, path, line, nonce: (s.reveal?.nonce ?? 0) + 1 },
  })),
```

**Why it's a bug:** reveal is a one-shot 'scroll to line' signal but is never reset to null after EditorPane consumes it; it persists in the store. EditorPane's effect (EditorPane.tsx:298, deps [reveal,tabId,relPath]) only re-fires when the reveal object identity changes. If a file is closed and reopened, the EditorPane remounts with viewRef=null at first; the persisted reveal object has the SAME identity (no new revealLine call), so the deps don't change after the view mounts and the editor never scrolls to the previously-revealed line. revealLine bumps nonce only on a NEW call, so a stale reveal pointing at a closed tab also lingers indefinitely (minor memory + a latent mis-fire if a new EditorPane mounts for that exact tabId+path). It's guarded enough to not crash, hence low.

**Trigger / repro:** Search-jump to a.ts line 50 (scrolls). Close a.ts. Re-open a.ts from the tree. The editor opens at the top; the previous reveal does not re-apply, and the stale reveal stays in the store.

**Suggested fix:** Add a consumeReveal()/clearReveal action that EditorPane calls after dispatching the scroll (set reveal:null), so the signal is truly one-shot and a remount re-requests via revealLine rather than relying on a stale object.

---

#### ⬜ LOW — Working-tree files over the 1 MB cap are silently HEAD-scanned (tail unscanned) with no skip and no truncation signal — secret in the tail is missed silently

- **Location:** `packages/app/src/main/secrets/scan.ts:33`  
- **Subsystem:** Secret-leak detection + LSP host  •  **Category:** edge-case  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
if (binary || modified.length > MAX_SCAN_BYTES) continue;
```

**Why it's a bug:** For the unstaged/untracked (working) side, `modified` is already truncated to <= MAX_FILE_BYTES (1,000,000) by readWorkspaceFile (which returns truncated:true). So `modified.length > MAX_SCAN_BYTES` is essentially never true on the working side, and scan.ts scans only the truncated HEAD while discarding the `truncated` flag entirely. A secret located past byte 1,000,000 in a >1MB working file is silently missed — no skip, no indication. Meanwhile the STAGED side gets the full untruncated blob from `git show`, so a >1MB staged file is skipped wholesale by this same check. The asymmetry means git_status (working) and the git_commit gate (staged) treat the same large file differently. Both large-file cases are within the documented 'size cap' non-goal, but the working-side behavior is a misleading partial scan rather than an honest skip, and the truncated flag from gitFileVersions is available but ignored.

**Trigger / repro:** Create a 2MB untracked/working file with a vaulted secret value after the 1MB mark. scanWorkingSet returns no leak for it (head scanned, tail dropped) — yet it is not reported as skipped either.

**Suggested fix:** Either honor the truncation explicitly (e.g. when a working file was truncated, surface that it was only partially scanned rather than silently scanning the head), or align the two sides. At minimum, capture and act on the `truncated` field returned by gitFileVersions instead of relying on a length compare that the pre-truncation already defeats.

---

#### ⬜ LOW — uriToRel mishandles Windows file:// URIs (leading-slash drive paths), can wrongly accept/reject definition + diagnostics targets

- **Location:** `packages/app/src/main/lsp/client.ts:46-54`  
- **Subsystem:** Secret-leak detection + LSP host  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const abs = decodeURIComponent(new URL(uri).pathname);
    const rel = path.relative(root, abs);
    return rel.startsWith("..") ? null : rel.split(path.sep).join("/");
```

**Why it's a bug:** For a Windows file URI (file:///C:/Users/...), new URL(uri).pathname yields "/C:/Users/..." with a leading slash. path.relative(root, "/C:/Users/...") on win32 compares a rooted path against a malformed one, producing an incorrect relative path (often a "..\.."-laden or wrong-drive result). This makes uriToRel — used by BOTH publishDiagnostics routing (101-108) and lspDefinition containment (276-277) — either drop in-workspace diagnostics or compute a wrong relPath/containment decision on Windows. On POSIX this is correct. Given the project is currently macOS-focused this is low severity, but the file is explicitly cross-platform-packaged (electron-builder) and the containment check here is security-relevant (it is the 'definition outside the root' guard).

**Trigger / repro:** On Windows, open a workspace and trigger go-to-definition / diagnostics; the file:// URI round-trips to a wrong relPath, dropping diagnostics or breaking the containment check.

**Suggested fix:** Use Node's url.fileURLToPath(uri) instead of decoding URL.pathname by hand — it strips the spurious leading slash and decodes percent-escapes correctly on both platforms. e.g. `import { fileURLToPath } from 'node:url'; const abs = fileURLToPath(uri);` then path.relative as before.

---

#### ⬜ LOW — ActivitySection: focus listener added in effect that also calls refresh — duplicate mount+focus trigger on section re-open

- **Location:** `packages/app/src/renderer/src/components/ActivitySection.tsx:53-58, 62-65`  
- **Subsystem:** Sidebar sections  •  **Category:** resource-leak  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
// Mount fetch + refresh on window focus.
useEffect(() => {
  void refresh();
  const onFocus = () => void refresh();
  window.addEventListener('focus', onFocus);
  return () => window.removeEventListener('focus', onFocus);
}, [refresh]);

// Also a separate onActivityChanged effect:
useEffect(
  () => window.airlock.onActivityChanged(() => void refresh()),
  [refresh],
);
```

**Why it's a bug:** If the window regains focus at the exact moment `refresh` is already in flight (e.g., from the `onActivityChanged` broadcast), two concurrent `activityStatus()` calls run and both call `setItems(list)`. The second one (from `onFocus`) may overwrite the result from the `onActivityChanged` callback with a slightly staler response. This is not a crash but can cause a brief flicker where a just-dismissed item reappears before the focus-triggered refresh overwrites it. More importantly, the busy spinner is toggled twice independently and the two `setBusy(true)`/`setBusy(false)` calls interleave unpredictably.

**Trigger / repro:** 1. Have a running CI activity item. 2. Alt-Tab away and back to the app rapidly. 3. Simultaneously, a dismiss event fires from another window. Two overlapping `activityStatus()` calls run with their independent `setBusy` cycles.

**Suggested fix:** Add a ref to track an in-flight refresh (e.g., `const inflight = useRef(false)`) and skip `refresh()` calls that arrive while one is pending, or use a stable lock with `useRef<AbortController>(null)` and cancel the previous request on each new invocation.

---

#### ⬜ LOW — NeonSection and RenderSection re-check connection status on every modal close, not just their own modal

- **Location:** `packages/app/src/renderer/src/components/NeonSection.tsx:46-59`  
- **Subsystem:** Sidebar sections  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
useEffect(() => {
  if (modal !== null) return;
  window.airlock
    .neonStatus()
    .then((s) => {
      if (mounted.current) setConnected(s.connected);
    })
    ...
}, [modal]);
```

**Why it's a bug:** The effect fires every time ANY modal closes (add-secret, connect-render, requestSecret, etc.), not just `connect-neon`. So closing the 'Add Secret' modal, the agent-request modal, or any other modal unnecessarily triggers a `neonStatus()` IPC round-trip (and similarly for `renderStatus()` in RenderSection). With N modals in the app, each modal-close triggers N status re-checks. While functionally correct, this causes unnecessary IPC noise and can cause connected=null flicker (the 'checking…' state reappears briefly before the response arrives) every time an unrelated modal closes.

**Trigger / repro:** 1. Connect to Neon. The tree is displayed. 2. Open and close the Add Secret modal. 3. The Neon section briefly shows 'checking…' before restoring the tree.

**Suggested fix:** Track which modal was last open in a ref and only re-check if the prior value was 'connect-neon': `const prevModal = useRef(modal); ... if (prevModal.current !== 'connect-neon' && prevModal.current !== null) { prevModal.current = modal; return; }`. Or use a specific 'connect-neon' IPC completion event instead of piggy-backing on modal state.

---

#### ⬜ LOW — DatabasesSection toggle: stale-closure on `expanded` causes double-fetch on rapid double-click

- **Location:** `packages/app/src/renderer/src/components/DatabasesSection.tsx:55-69`  
- **Subsystem:** Sidebar sections  •  **Category:** correctness  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const toggle = async (id: string) => {
  const next = !expanded[id];  // reads stale render value
  setExpanded((e) => ({ ...e, [id]: next }));
  if (next && !tables[id]) {
    setBusy(true);
    try {
      const t = await window.airlock.dbTables(root, id);
      setTables((m) => ({ ...m, [id]: t }));
    ...
  }
};
```

**Why it's a bug:** `next = !expanded[id]` reads from the render closure, not from the latest committed state. On a rapid double-click, two `toggle` calls execute before any state update; both see `expanded[id] = false`, both set `next = true`, both call `setExpanded((e) => ({...e, [id]: true}))` (net result: stays true, doesn't toggle back), and BOTH initiate a `dbTables` fetch. The second fetch's `setTables((m) => ({...m, [id]: t}))` lands after the first and overwrites with identical data (a wasted IPC call). More importantly the expand/collapse toggle is broken on double-click.

**Trigger / repro:** Rapidly double-click a database row in the Databases section. The row expands but cannot be collapsed by the second click; it stays open.

**Suggested fix:** Use `setExpanded` with a functional updater and derive `next` inside it, or use `useRef` to track an in-progress expand. Guard the fetch with a debounce or a per-id in-flight flag.

---

#### ⬜ LOW — SecretModal: secrets list in sidebar not refreshed after updating a secret in the 'add' flow when name is changed mid-validation-error

- **Location:** `packages/app/src/renderer/src/components/SecretModal.tsx:38, 95-99`  
- **Subsystem:** Sidebar sections  •  **Category:** data-loss  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
const [name, setName] = useState(requested?.name ?? updating ?? "");
// ...
!updating && (
  <>
    <input
      ...
      value={name}
      onChange={(e) => setName(e.target.value.toUpperCase())}
    />
  </>
)
// ...
if (!meta.valid) {
  setError('Saved, but the value looks unusual...');
  // setSecrets NOT called
}
```

**Why it's a bug:** In add-secret mode (not update, not requested), after `meta.valid === false` the error is shown and the name field remains editable. The user can change the name and submit again. Each submission calls `secretsSet` and creates a new keychain entry under the new name, but `setSecrets` is never called between submissions. After two submissions with different names both failing validation, the sidebar is missing two secrets. The user has no indication of this until they Cancel (which then calls `setSecrets`).

**Trigger / repro:** 1. Add a secret with name A — fails validation (meta.valid=false). 2. Change the name to B and submit again — fails validation again. 3. Cancel the modal. 4. The sidebar now shows both A and B suddenly appearing — they were created but invisible.

**Suggested fix:** Same as finding #2 — call `setSecrets(await window.airlock.secretsList(root))` in the `!meta.valid` branch.

---

#### ⬜ LOW — AuditSection tooltip renders e.detail as raw JSON, exposing audit detail object to tooltip inspection

- **Location:** `packages/app/src/renderer/src/components/AuditSection.tsx:40-44`  
- **Subsystem:** Sidebar sections  •  **Category:** ux-bug  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
<div
  key={e.hash}
  className="audit-row"
  title={JSON.stringify(e.detail)}
>
```

**Why it's a bug:** AuditEntry.detail is typed as `Record<string, unknown>` and is populated with objects like `{ name, imported, deleted, skipped, failed }` for import operations and `{ name }` for reveal/copy/set operations. The `title` attribute shows this as a tooltip on hover. While current detail entries contain only secret NAMES (no values), the type is `unknown`, leaving the door open for a future `appendAudit` call to inadvertently include a value. The tooltip is also unformatted JSON visible to anyone who hovers, which is awkward UX. Any value accidentally logged in `detail` would be directly readable here.

**Trigger / repro:** Open the Audit section, hover over any row — a tooltip appears with raw JSON of the detail object.

**Suggested fix:** Redact the tooltip or only show the operation name + timestamp. If detail must be shown, explicitly whitelist safe keys (e.g., only `name`, `imported.length`, etc.) rather than JSON-stringifying the full unknown object.

---

#### ⬜ LOW — fs:readFile missing assertNotVault — renderer can read .airlock/ vault metadata directly

- **Location:** `packages/app/src/main/ipc.ts:324-327`  
- **Subsystem:** app/main core (prefs/state/activity/agent/fsWatch)  •  **Category:** security  •  **Verification:** 🔶 PENDING (verifier killed by session limit — treat as candidate)


**Evidence**
```
ipcMain.handle("fs:readFile", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    return readWorkspaceFile(resolveRoot(e, root), relPath);
  });
```

**Why it's a bug:** fs:readImage and fs:openExternalFile both call assertNotVault(relPath) but fs:readFile does not. A renderer can read .airlock/secrets.json (which contains secret names, providers, and audit metadata) or .airlock/audit.jsonl directly. Secret VALUES are in the OS keychain so they are not exposed, but the vault metadata (which names are registered, their providers) is exposed — duplicating what secrets:list already provides but without the filtering that secrets:list applies.

**Trigger / repro:** From the renderer: `await ipcRenderer.invoke('fs:readFile', root, '.airlock/secrets.json')` returns the vault metadata JSON.

**Suggested fix:** Add `assertNotVault(relPath);` after the typeof check, matching fs:readImage and fs:openExternalFile.

---

## Appendix — reviewers' overflow notes

_Additional observations the reviewers recorded but did not promote to full findings (extra bypasses, accepted-by-design items, and lower-value nits). Verbatim._

**Command policy + injected run**

> Additional CONFIRMED classifier bypasses were found but are partly covered by the design's explicit non-goal ('a deliberately obfuscated command can evade the string check'), so they are folded here rather than listed as top findings: (1) backtick / $() command substitution -- `rm -rf /` in backticks and $(rm -rf /) are NOT classified destructive (the char before rm is a backtick or `(`); (2) case sensitivity -- CURL/SUDO evade all patterns since the regexes are case-sensitive; (3) the network category is `allow` by DEFAULT, so curl/wget exfil of the leaked env (finding #1) is unimpeded -- worth a product note even though it matches DEFAULT_AGENT_POLICY. Also a minor correctness nit (not reported as a finding): run.ts:148 `combined` prepends a stray leading newline when stdout is empty but stderr is non-empty; harmless to redaction. Net recommendation: treat the classifier as advisory-only and make the redaction-set fix (#1/#2) plus cwd containment (#5) the real boundary, since the spec already concedes the heuristic is evadable.

**Editor / terminal / tabs components**

> One additional finding not in the top 8: In `TerminalPane.tsx`, the flow-control XOFF/XON mechanism has a logical gap: `writeChunk` only sends XOFF when `!paused && unflushed > HIGH && idRef.current`. If `idRef.current` is null (during the pending window), the high-water mark is crossed without sending XOFF, and the PTY child is not paused. The callback fires when the flushed bytes drop below LOW and calls XON even if XOFF was never sent. The `paused` flag prevents sending a spurious XON (since `paused` is false when XOFF was never sent, the `if (paused && ...)` branch is skipped). This is correctly handled. Not a bug.

**FileTree / Search / Palette / Viewer**

> A few lower-value items were examined and deliberately not reported: (1) `move()` in agent-core/workspace/fileOps.ts blocks a case-only rename on case-insensitive macOS (exists(toAbs) is true for the same inode) — a real UX bug but outside this subsystem's renderer files. (2) Search `preview` is sliced to 200 chars while `col` is the offset into the full line, so a match past col 200 renders unhighlighted and a match near the boundary highlights partially — acceptable degradation, no crash. (3) DataGrid 'N rows' badge silently undercounts because rows are capped at 100 and QueryResult has no truncated flag — known limitation, not a clear defect. (4) DnD move failures in doMove are caught and only console.error'd (no user feedback) — minor UX. The XSS/unsafe-injection vector was specifically audited and is clean: every filename/search-match/cell value is rendered via React text interpolation (auto-escaped), there is no dangerouslySetInnerHTML/innerHTML anywhere, the image preview uses a data: URL that the renderer CSP (`img-src 'self' data:`) explicitly allows, and the context-menu position uses numeric left/top. No secret-leak path exists in these components (search reads workspace files the user can already open; the agent-blind vault is not touched here).

**Hash-chained audit**

> Two additional behaviors were examined and deliberately NOT reported. (1) Truncation (total wipe and trailing-entry drop) is undetectable by verifyAuditChain -- confirmed empirically (returns true), but this is an explicitly documented/accepted design limitation in docs/superpowers/specs/2026-06-03-airlock-v1-design.md (section 7: 'audit-log truncation (dropping whole trailing entries) remains undetectable by the hash chain') and the 2026-06-03 hardening WONTFIX record, so per the design spec it is intended behavior, not a defect. (2) computeHash is order-sensitive on detail keys (reordering semantically-equal detail keys makes verify return false) -- this is correct/desirable for a hash chain and detail is round-tripped via JSON so insertion order is preserved on normal reads; not a bug. Secret-value leakage into audit `detail` was checked at every call site (broker.ts setSecret/deleteSecret/injectInto/importDotEnv/setGlobalSecret, and ipc.ts secret.reveal/copy/terminal.read, mcp/tools.ts) -- all log names/metadata only, never values, so that invariant holds.

**IPC contract + preload bridge**

> Lower-severity items not promoted into the top findings: (1) fileOrder:set accepts an unvalidated `folderRel` string used as a JSON map key written into the single committed .airlock-order.json (resolveWithin confines the file itself, so no path escape -- only garbage keys/data-quality, very low impact). (2) redactConnStrings only redacts scheme://userinfo@host form; a Postgres URL carrying the password as a query param (?password=...) in a driver/DNS error message would pass through the db:*/neon:* error paths un-redacted -- defense-in-depth gap on an error path I could not concretely trigger, so left out. (3) workspace:setActive does no path validation either, but it adds no new exposure beyond finding #1 (the agent's switch_tab uses tabId, and any arbitrary-root capability already comes from open_tab). The contract itself is otherwise clean: all 82 main handlers have matching preload calls (agent:command-result and agent:request-secret-resolved are handled in agent-commands.ts / agent-requests.ts), every main->renderer push channel has a preload subscribe, and the invoke/send argument ORDER matches the handler parameter order across all multi-arg channels (db:rows, neon:rows, lsp:*, fs:move, etc.). No channel-name or arg-order drift found.

**MCP IDE-bridge server**

> Minor non-reported items judged below the bar or out of scope: (1) listenWithFallback tries 9 distinct ports, not the 10 implied by PORT_ATTEMPTS/the comment (off-by-one in `attemptsLeft > 1`) — cosmetic, no security impact. (2) res.on('close') teardown does `void transport.close()` / `void server.close()` — a rejecting close() would be an unhandled rejection, but SDK close() rejecting is unlikely and not security-relevant. (3) listTerminals/getTerminalTail skip the window filter when lastFocusedWindowId() is null — verified NOT exploitable because lastFocusedRoot() derives its id from lastFocusedWindowId(), so whenever `root` is non-null `winId` is the same non-null id and the precise root filter binds (no cross-window/project leak); deliberately not reported as it would be a false positive. I traced the allowlist (22 tools, no getSecretValue/getGlobalSecret), the source-guard, resources (value-free docs), guardedCommit/scanWorkingSet (value-free SecretLeak shape, binary/oversize-safe), request_secret (boolean-only), and per-tab terminal scoping — all of those invariants hold."

**Output redaction**

> One additional lower-severity real defect (kept out of the top set due to contrived trigger): in redactEncoded's hex pass (redact.ts:94-98), an odd-length hex run is normalized via `run.slice(0, -1)` which always drops the LAST nibble. If a secret's (even-length) hex encoding is concatenated with no delimiter to an ODD number of leading hex characters, the correct even-aligned substring is `run.slice(1)`, not `run.slice(0,-1)`; dropping the last nibble mis-aligns every byte so the secret bytes are not found and the hex (decodable to the secret) survives. Confirmed: redactSecrets('abc'+hex(secret),[secret]) leaks the hex, whereas the realistic case (hex as its own whitespace-delimited token, even length) is caught. Fix: try both parities (slice(0,-1) and slice(1)) or scan at both offsets. Practical only when hex is glued to odd-length hex with no separator, so severity is low. Also worth noting (not a defect, for the record): a pure case variant of an ASCII secret (e.g. SECRET123 vs Secret123) is NOT redacted, but that is unavoidable -- an uppercased string is a different value the redactor cannot know is the secret; only encoding transforms that preserve the original bytes (base32/percent/json above) are genuine bypasses.

**PTY / host / docker / render / github / project / mcp-register**

> One additional medium-severity finding was identified: in pty:create (ipc.ts line 970), when injectSecretsIntoTerminal is enabled, the pty:create handler reads readProjectConfig and injectInto under the same async gap that causes the sessionRoots race above. If the root is null at line 971 (no folder open), secretEnv is correctly skipped. However, the secretEnv from the original root is used even if the tab switch causes cwd=projectA but secrets injected from the already-computed injectInto call (also projectA) — so injection itself is consistent; only the sessionRoots tag is wrong (the primary finding #1 above captures this fully).

**Postgres + Neon**

> No additional real defects beyond the 3 reported. I adversarially tested and CLEARED the other invariants: (1) quoteIdent in explorer.ts correctly doubles embedded quotes -- DROP TABLE / closing-quote / a\".\"b breakout attempts all collapse into a single quoted identifier that errors harmlessly; null bytes and newlines in identifiers are rejected by pg. (2) readRows limit clamp matches the plan (NaN/Infinity/<=0 -> 100, >1000 -> 1000, fractional floored). (3) parseConnString NEVER echoes u.password -- redacted is rebuilt from protocol/username/host/pathname only; password-only userinfo (':pw@') drops the userinfo entirely; IPv6, encoded chars, and unparseable->placeholder all behave. (4) withDb's connect() failing before the try/finally does not leak a socket (node-postgres destroys its stream on connect error/timeout). (5) Neon parsers (parse.ts) tolerate null/missing/object-typed/array-typed payloads -> [], and parseConnectionUri throws on empty/absent/non-string uri. (6) IPC handlers validate renderer arg types (allStr / typeof checks) and rethrow fresh Errors with no `cause`. Neon list pagination is not handled but is not a stated requirement, so I did not report it."

**Renderer lib + hooks**

> No additional real bugs were found beyond the five reported. Candidates examined and ruled out: (1) lspDiagnostics/lspPositions UTF-16 handling — both correctly use JS string (UTF-16) indices matching LSP spec and CodeMirror's model. (2) useFsWatch / useGitStatus / useAgentCommands / useMenuActions IPC subscription leaks — all effects correctly return the unsubscribe function. (3) terminalSlots register/unregister race — correctly guarded with the element-identity check inside the functional state updater. (4) language.ts .env rejection — intentional via dot <= 0 guard. (5) lspCompletions empty insertText — nullish coalescing is correct (empty string is valid LSP). (6) closeEditorFile async-gap state staleness — store action is idempotent, harmless. (7) buildSnapshot in useAgentCommands leaking sensitive data — only id/name/root/focused/inSplit/terminals(id+title) are included; no file content, secrets, or env values cross.

**Renderer store (zustand)**

> Two additional lower-severity items not in the top list: (1) restartActiveTerminal (lib/restartActiveTerminal.ts) reads tabTerminals[tid] before removeTerminal then re-checks after; between the synchronous removeTerminal and addTerminal there's no race in the store, but if the removed terminal was a split member the split is silently dropped on every secret-vault restart (acceptable but undocumented vs the 'restart keeps siblings' test which only checks count). (2) setActiveTerminal/viewItem trust a caller-supplied terminal id with no membership check — if a caller passes an id absent from the tab's terminal list, deriveView sets activeTerminalId to a ghost, MainTabs.renderTab returns null for it, and ProjectTerminals shows 0 panes while terminals.length>0 (respawn effect gated on length===0 won't fire) -> blank main area until another action. No current in-repo caller does this, so it's latent, but there is no defensive guard.

**Secret broker**

> A few lower-value observations were examined and deliberately not promoted to findings: (1) meta.ts upsertMeta/removeMeta do unlocked read-modify-write, so two concurrent setSecret/deleteSecret calls can lose a meta entry (last-writer-wins); reachable only via two simultaneous in-flight secrets:set/delete IPC calls, app-level and unlikely, keychain values are unaffected. (2) parseDotEnv only strips a trailing inline comment when preceded by a literal space-hash ' #'; a TAB before '#' (value\\t# note) keeps the comment as part of the stored value, and `A= # comment` stores '# comment' as the value — cosmetic/quirk, no security impact. (3) Redaction (redact.ts, outside this subsystem) exact-matches the stored value verbatim, so a double-quoted whitespace-padded .env value (PEM=\"  x  \") is stored padded and would not be redacted if echoed unpadded — belongs to the redact subsystem review. (4) Direct setSecret where keychain.set throws leaves a dangling meta entry with no audit row; the code comments (broker.ts:45-49) explicitly accept this degrade, so not reported as a defect. The two highest-severity issues are the dangerous-env-set gap (critical) and the readMeta non-array/corruption handling (medium x2).

**Secret-leak detection + LSP host**

> Two lower-value items were folded into the findings above rather than listed separately: (a) lspDidOpen/lspDidChange/lspDidClose call s.conn.sendNotification after `await s.ready` with no try/catch, so after a tsserver crash these throw into the renderer's fire-and-forget calls — same root cause as the LSP-crash finding (no crash detection); (b) lspHover/lspCompletion/lspDefinition all call ensure(root), which SPAWNS a server on a hover/definition even when the file was never didOpen'd (the header comment claims 'spawned lazily on first didOpen') — spawns an extra server with no document content; minor. Also noted but not separately reported: the initialize() .catch at client.ts:126 swallows initialize failure so `ready` always resolves, meaning a server whose tsserver path is wrong (e.g. the packaged ts-lib stripping noted in the file's own comment) is treated as 'ready' and silently returns zero diagnostics/members rather than erroring — worth hardening alongside the crash-reaping fix. No additional secret-VALUE leak paths were found beyond the multi-line false-negative: SecretLeak/CommitOutcome and the git_status/git_commit MCP results are value-free by construction, and encoded-in-file values are an explicitly documented v1 non-goal.

**Sidebar sections**

> Additional confirmed finding not included due to the 8-item cap: In `NeonSection.expandProject` and `expandBranch`, the `toggle(key)` call uses `setExpanded(e => ({...e, [key]: !e[key]}))` which correctly inverts the current state. However, `expandProject` captures `wasOpen = !!expanded[projectId]` BEFORE calling `toggle`. On rapid double-click, two calls both see `wasOpen=false` and both initiate branch fetches; the second fetch overwrites the first's result silently. Same pattern as the DatabasesSection double-fetch finding (#6), severity low.

**Workspace file ops**

> Two lower-severity items not in the top list: (1) read.ts readWorkspaceFile binary probe only scans the first 8000 bytes (git's heuristic) — a file that is text in its first 8KB but contains NUL bytes later is decoded as UTF-8 with the NULs passed through into the editor; bounded/cosmetic, matches git, likely intentional. (2) readImageDataUrl (read.ts:71) trusts the extension for the mime type and never sanity-checks magic bytes, so a non-image file renamed .png is base64'd into an image data URL; low impact and fs:readImage is vault-guarded. No path-traversal escape was found in resolveWithin — the sibling-prefix check correctly uses realRoot + path.sep, symlinks are realpath'd before the containment check (including the non-existent-suffix walk-up), absolute paths and .. are rejected, and null bytes make fs calls throw rather than reaching the vault; listFilesRecursive/search correctly prune .airlock via the IGNORED set so fs:listAll and fs:search do NOT leak the vault (only fs:listDir + fs:readFile + fs:writeFile do).

**app/main core (prefs/state/activity/agent/fsWatch)**

> No additional real bugs were found beyond the 8 reported. Other things examined and rejected: the `workspace:open` path validation (no path-traversal risk because downstream handlers use resolveWithin); the `lastFocusedWindowId` fallback chain (functions correctly); the `prefs.json` `.tmp` atomic-write pattern (correct); the `dismissed` Set in activity.ts (app-global, intentional, no leak); the `agent-requests` busy guard (correct for its intended single-in-flight semantics, only the window-close case is an issue as reported).
