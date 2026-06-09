# Per-project GitHub Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each project uses its own GitHub account for push/pull/fetch and commit authorship, concurrently, auto-detected from the repo with a manual override — no machine-wide `gh auth switch`.

**Architecture:** Resolve a project's account (override in `.airlock/config.json` → auto from `origin` owner → none). For HTTPS remotes, fetch that account's token via `gh auth token --user` and inject it into the single `git` network call through an inline credential helper with the token in the child **env** (never argv) — so concurrent projects authenticate independently. Set per-repo commit identity to match the account before commits.

**Tech Stack:** TypeScript monorepo (`@airlock/agent-core` pure logic + `@airlock/app` Electron), React 19 renderer, Vitest, Biome, the `gh` CLI (2.87.3).

**Conventions (verified in-repo):**
- Unit-test **pure** modules; keep electron/`execFile` wiring thin and untested (mirrors `fsWatch.ts`/`git/run.ts`).
- `runGit(root, args)` shells out via `execFile` (no shell), cwd=root. Errors throw with stderr.
- `GhRunner = (args) => Promise<string>` injects the gh exec for tests (`github/accounts.ts`).
- Run one test file: `npx vitest run <path>`. Gates: `npm test`, `npm run typecheck`, `npm run lint` (biome; **warnings OK, errors fail** — run `npx biome check --write <files>` before committing).
- Commit style: `type(scope): summary`.

Spec: `docs/superpowers/specs/2026-06-09-per-project-github-account-design.md`.

---

## File Structure

**Create (agent-core):**
- `packages/agent-core/src/git/remote.ts` — pure `parseRemote(url)` + `getOrigin(root)`.
- `packages/agent-core/src/git/remote.test.ts`
- `packages/agent-core/src/git/auth.ts` — `buildAuthedArgs`, `runGitAuthed`.
- `packages/agent-core/src/git/auth.test.ts`
- `packages/agent-core/src/git/identity.ts` — `ensureCommitIdentity`.
- `packages/agent-core/src/git/identity.test.ts`
- `packages/agent-core/src/git/resolve.ts` — pure `resolveProjectAccount`.
- `packages/agent-core/src/git/resolve.test.ts`
- `packages/app/src/main/github/account.ts` — main-side resolver (`tokenFor`, `ensureIdentityFor`, `resolveFor`).

**Modify:**
- `packages/agent-core/src/github/accounts.ts` — `ghToken`, `parseGhUser`, `ghUserIdentity`; `GhRunner` gains optional env.
- `packages/agent-core/src/project/config.ts` — `ProjectConfig.githubAccount?`.
- `packages/agent-core/src/project/config.test.ts` — round-trip.
- `packages/agent-core/src/git/ops.ts` — `gitFetch/gitPull/gitPush` accept optional `token`.
- `packages/agent-core/src/index.ts` — export the new symbols.
- `packages/app/src/shared/ipc.ts` — `ResolvedGithubAccount` + 2 `AirlockApi` methods.
- `packages/app/src/preload/index.ts` — bridge the 2 methods.
- `packages/app/src/main/ipc.ts` — route git ops through resolver; 2 new handlers.
- `packages/app/src/renderer/src/components/GitSection.tsx` — account readout + override.

---

## Task 1: Shared types + ProjectConfig.githubAccount

**Files:**
- Modify: `packages/app/src/shared/ipc.ts`
- Modify: `packages/agent-core/src/project/config.ts`
- Test: `packages/agent-core/src/project/config.test.ts`

- [ ] **Step 1: Write the failing config test**

Append to `packages/agent-core/src/project/config.test.ts` (match existing imports; it already uses `mkdtemp`/`tmpdir`/`path` — add any missing):

```ts
it("round-trips an optional githubAccount override", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-gh-"));
  expect((await readProjectConfig(dir)).githubAccount).toBeUndefined();
  await writeProjectConfig(dir, {
    githubAccount: { host: "github.com", username: "RicardoRamosT" },
  });
  expect((await readProjectConfig(dir)).githubAccount).toEqual({
    host: "github.com",
    username: "RicardoRamosT",
  });
  // Passing undefined clears it (JSON.stringify omits undefined keys).
  await writeProjectConfig(dir, { githubAccount: undefined });
  expect((await readProjectConfig(dir)).githubAccount).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/project/config.test.ts`
Expected: FAIL (type error / `githubAccount` not on `ProjectConfig`).

- [ ] **Step 3: Add the field**

In `packages/agent-core/src/project/config.ts`, add to the `ProjectConfig` interface (after `devUrl`):

```ts
  // Per-project GitHub account override for git remote ops + commit identity.
  // Absent => auto-detect from the repo's origin owner. Stores only a reference
  // (host + username), never a credential.
  githubAccount?: { host: string; username: string };
```

- [ ] **Step 4: Add the shared IPC type + API**

In `packages/app/src/shared/ipc.ts`, add near the other small interfaces:

```ts
/**
 * The GitHub account AirLock will use for a project's git remote ops + commit
 * identity. `source` is how it was chosen; `protocol` is the origin remote's
 * transport (token injection only applies to https). `account` is null when no
 * account could be resolved (no remote, or an org repo with no matching login).
 */
export interface ResolvedGithubAccount {
  account: { host: string; username: string } | null;
  source: "override" | "auto" | "none";
  protocol: "https" | "ssh" | "unknown";
}
```

Add to the `AirlockApi` interface (near `githubInfo`/`githubSwitch`):

```ts
  // Per-project GitHub account: which account a project resolves to, and a
  // setter to persist (or clear, with null) a manual override.
  resolveGithubAccount(root: string): Promise<ResolvedGithubAccount>;
  setProjectGithubAccount(
    root: string,
    account: { host: string; username: string } | null,
  ): Promise<void>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/project/config.test.ts` → PASS.
Run: `npm run typecheck`. Expected: it FAILS in `preload/index.ts` (AirlockApi now has unimplemented methods) — that's wired in Task 7. To keep this task green on its own, also add the preload stubs now:

In `packages/app/src/preload/index.ts`, add to the `api` object (after `githubSwitch`):

```ts
  resolveGithubAccount: (root) =>
    ipcRenderer.invoke("github:resolveAccount", root),
  setProjectGithubAccount: (root, account) =>
    ipcRenderer.invoke("github:setProjectAccount", root, account),
```

Re-run `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/agent-core/src/project/config.ts packages/agent-core/src/project/config.test.ts packages/app/src/preload/index.ts
git commit -m "feat(gh): shared types + per-project githubAccount config + preload bridge"
```

---

## Task 2: parseRemote + getOrigin

**Files:**
- Create: `packages/agent-core/src/git/remote.ts`
- Test: `packages/agent-core/src/git/remote.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-core/src/git/remote.test.ts`:

```ts
import { expect, it } from "vitest";
import { parseRemote } from "./remote";

it("parses https remotes with and without .git", () => {
  expect(parseRemote("https://github.com/RicardoRamosT/Airlock-IDE.git")).toEqual(
    { host: "github.com", owner: "RicardoRamosT", repo: "Airlock-IDE", protocol: "https" },
  );
  expect(parseRemote("https://github.com/ViewNear/lend")).toEqual(
    { host: "github.com", owner: "ViewNear", repo: "lend", protocol: "https" },
  );
});

it("parses scp-style and ssh:// remotes as ssh", () => {
  expect(parseRemote("git@github.com:RicardoRamosT/Airlock-IDE.git")).toEqual(
    { host: "github.com", owner: "RicardoRamosT", repo: "Airlock-IDE", protocol: "ssh" },
  );
  expect(parseRemote("ssh://git@github.com/ViewNear/lend.git")).toEqual(
    { host: "github.com", owner: "ViewNear", repo: "lend", protocol: "ssh" },
  );
});

it("returns null for unrecognized input", () => {
  expect(parseRemote("")).toBeNull();
  expect(parseRemote("not a url")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/git/remote.test.ts`
Expected: FAIL ("Cannot find module './remote'").

- [ ] **Step 3: Implement remote.ts**

```ts
import { runGit } from "./run";

export interface ParsedRemote {
  host: string;
  owner: string;
  repo: string;
  protocol: "https" | "ssh";
}

// Parse a git remote URL into its parts. Supports https, scp-style (git@host:),
// and ssh:// forms; strips a trailing .git and slash. Returns null otherwise.
export function parseRemote(url: string): ParsedRemote | null {
  const https = url.match(
    /^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  );
  if (https?.[1] && https[2] && https[3]) {
    return { host: https[1], owner: https[2], repo: https[3], protocol: "https" };
  }
  const scp = url.match(/^[^@\s]+@([^:]+):([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (scp?.[1] && scp[2] && scp[3]) {
    return { host: scp[1], owner: scp[2], repo: scp[3], protocol: "ssh" };
  }
  const ssh = url.match(
    /^ssh:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  );
  if (ssh?.[1] && ssh[2] && ssh[3]) {
    return { host: ssh[1], owner: ssh[2], repo: ssh[3], protocol: "ssh" };
  }
  return null;
}

// Read the origin remote URL (thin wrapper over runGit; returns null if there
// is no origin remote).
export async function getOrigin(root: string): Promise<string | null> {
  try {
    return (await runGit(root, ["remote", "get-url", "origin"])).trim() || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/git/remote.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/git/remote.ts packages/agent-core/src/git/remote.test.ts
git commit -m "feat(gh): parse git remote URLs (host/owner/repo/protocol)"
```

---

## Task 3: ghToken + ghUserIdentity

**Files:**
- Modify: `packages/agent-core/src/github/accounts.ts`
- Test: `packages/agent-core/src/github/accounts.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/agent-core/src/github/accounts.test.ts`:

```ts
import { ghToken, ghUserIdentity, parseGhUser } from "./accounts";

it("ghToken requests the token for a specific account", async () => {
  let seen: string[] = [];
  const run = async (args: string[]) => {
    seen = args;
    return "gho_TESTTOKEN\n";
  };
  const tok = await ghToken("github.com", "RicardoRamosT", run);
  expect(tok).toBe("gho_TESTTOKEN");
  expect(seen).toEqual([
    "auth", "token", "--hostname", "github.com", "--user", "RicardoRamosT",
  ]);
});

it("parseGhUser uses name+email, falling back to login and noreply", () => {
  expect(
    parseGhUser('{"login":"rrt","id":42,"name":"Ricardo","email":"r@x.com"}'),
  ).toEqual({ name: "Ricardo", email: "r@x.com" });
  expect(parseGhUser('{"login":"rrt","id":42,"name":null,"email":null}')).toEqual(
    { name: "rrt", email: "42+rrt@users.noreply.github.com" },
  );
});

it("ghUserIdentity passes the token via env, not argv", async () => {
  let seenArgs: string[] = [];
  let seenEnv: Record<string, string> | undefined;
  const run = async (args: string[], env?: Record<string, string>) => {
    seenArgs = args;
    seenEnv = env;
    return '{"login":"rrt","id":7,"name":"R","email":null}';
  };
  const id = await ghUserIdentity("github.com", "rrt", "gho_SECRET", run);
  expect(id).toEqual({ name: "R", email: "7+rrt@users.noreply.github.com" });
  expect(seenArgs).toEqual(["api", "user", "--hostname", "github.com"]);
  expect(seenEnv?.GH_TOKEN).toBe("gho_SECRET");
  expect(seenArgs.join(" ")).not.toContain("gho_SECRET");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/github/accounts.test.ts`
Expected: FAIL (`ghToken`/`ghUserIdentity`/`parseGhUser` not exported).

- [ ] **Step 3: Implement in accounts.ts**

In `packages/agent-core/src/github/accounts.ts`, change the `GhRunner` type and `realGh` to support env:

```ts
export type GhRunner = (
  args: string[],
  env?: Record<string, string>,
) => Promise<string>;

const realGh: GhRunner = async (args, env) => {
  const { stdout } = await exec("gh", args, {
    maxBuffer: 4 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return stdout;
};
```

Add at the end of the file:

```ts
export interface GhIdentity {
  name: string;
  email: string;
}

// Token for a SPECIFIC account (not the active one) — no global switch.
export async function ghToken(
  host: string,
  username: string,
  run: GhRunner = realGh,
): Promise<string> {
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^[A-Za-z0-9-]+$/.test(username)) {
    throw new Error("Invalid host or username");
  }
  return (await run(["auth", "token", "--hostname", host, "--user", username])).trim();
}

// Parse `gh api user` JSON into a commit identity. name -> login fallback;
// email -> GitHub no-reply form when private/null.
export function parseGhUser(json: string): GhIdentity {
  const u = JSON.parse(json) as {
    login?: string;
    id?: number;
    name?: string | null;
    email?: string | null;
  };
  const login = u.login ?? "";
  const name = (u.name && u.name.trim()) || login;
  const email =
    (u.email && u.email.trim()) ||
    `${u.id}+${login}@users.noreply.github.com`;
  return { name, email };
}

// Commit identity for a specific account: `gh api user` authenticated with that
// account's token (passed via env, never argv).
export async function ghUserIdentity(
  host: string,
  username: string,
  token: string,
  run: GhRunner = realGh,
): Promise<GhIdentity> {
  void username; // identity comes from the token; username kept for the call site
  return parseGhUser(await run(["api", "user", "--hostname", host], { GH_TOKEN: token }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/github/accounts.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/github/accounts.ts packages/agent-core/src/github/accounts.test.ts
git commit -m "feat(gh): per-account token + identity via gh (env-passed token)"
```

---

## Task 4: runGitAuthed (token-injecting git)

**Files:**
- Create: `packages/agent-core/src/git/auth.ts`
- Test: `packages/agent-core/src/git/auth.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-core/src/git/auth.test.ts`:

```ts
import { expect, it } from "vitest";
import { buildAuthedArgs, runGitAuthed } from "./auth";

it("builds two -c flags that disable the inherited helper then supply ours", () => {
  const args = buildAuthedArgs(["push"]);
  expect(args[0]).toBe("-c");
  expect(args[1]).toBe("credential.helper="); // clears inherited helpers
  expect(args[2]).toBe("-c");
  expect(args[3]).toContain("credential.helper=");
  expect(args[3]).toContain("AIRLOCK_GH_TOKEN"); // reads token from env
  expect(args.at(-1)).toBe("push");
});

it("runs git with the token in env, never in argv", async () => {
  let seenArgs: string[] = [];
  let seenEnv: NodeJS.ProcessEnv | undefined;
  const fakeExec = async (
    args: string[],
    opts: { cwd: string; env?: NodeJS.ProcessEnv; maxBuffer: number },
  ) => {
    seenArgs = args;
    seenEnv = opts.env;
    return { stdout: "ok" };
  };
  const out = await runGitAuthed("/repo", "gho_SECRET", ["push"], fakeExec);
  expect(out).toBe("ok");
  expect(seenEnv?.AIRLOCK_GH_TOKEN).toBe("gho_SECRET");
  expect(seenArgs.join(" ")).not.toContain("gho_SECRET");
  expect(seenArgs).toContain("push");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/git/auth.test.ts`
Expected: FAIL ("Cannot find module './auth'").

- [ ] **Step 3: Implement auth.ts**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runGit } from "./run";

const exec = promisify(execFile);

// Inline git credential helper: on a `get` request, print x-access-token + the
// token read from $AIRLOCK_GH_TOKEN. Token stays in the env, never in argv.
const CREDENTIAL_HELPER =
  '!f() { test "$1" = get && printf "username=x-access-token\\npassword=%s\\n" "$AIRLOCK_GH_TOKEN"; }; f';

// Prepend: clear inherited helpers (so gh's global helper does not also fire),
// then install ours.
export function buildAuthedArgs(args: string[]): string[] {
  return [
    "-c",
    "credential.helper=",
    "-c",
    `credential.helper=${CREDENTIAL_HELPER}`,
    ...args,
  ];
}

export type GitExec = (
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; maxBuffer: number },
) => Promise<{ stdout: string }>;

const realExec: GitExec = (args, opts) => exec("git", args, opts);

// Run a git network op authenticated as a specific account's token. With a null
// token, falls back to plain runGit (today's credential-helper behavior).
export async function runGitAuthed(
  root: string,
  token: string | null,
  args: string[],
  run: GitExec = realExec,
): Promise<string> {
  if (!token) return runGit(root, args);
  try {
    const { stdout } = await run(buildAuthedArgs(args), {
      cwd: root,
      env: { ...process.env, AIRLOCK_GH_TOKEN: token },
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      e.stderr?.trim() || e.stdout?.trim() || e.message || "git failed",
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/git/auth.test.ts` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/git/auth.ts packages/agent-core/src/git/auth.test.ts
git commit -m "feat(gh): runGitAuthed injects a per-account token via env"
```

---

## Task 5: ensureCommitIdentity

**Files:**
- Create: `packages/agent-core/src/git/identity.ts`
- Test: `packages/agent-core/src/git/identity.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-core/src/git/identity.test.ts`:

```ts
import { expect, it } from "vitest";
import { ensureCommitIdentity } from "./identity";

function fakeRun(current: Record<string, string>) {
  const calls: string[][] = [];
  const run = async (_root: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "config" && args[1] === "--local" && args.length === 3) {
      return current[args[2]] ?? ""; // a read
    }
    return ""; // a write
  };
  return { run, calls };
}

it("writes name and email when they differ", async () => {
  const { run, calls } = fakeRun({ "user.name": "Old", "user.email": "old@x" });
  await ensureCommitIdentity("/r", { name: "New", email: "new@x" }, run);
  expect(calls).toContainEqual(["config", "--local", "user.name", "New"]);
  expect(calls).toContainEqual(["config", "--local", "user.email", "new@x"]);
});

it("writes nothing when identity already matches", async () => {
  const { run, calls } = fakeRun({ "user.name": "Same", "user.email": "s@x" });
  await ensureCommitIdentity("/r", { name: "Same", email: "s@x" }, run);
  const writes = calls.filter((c) => c.length === 5);
  expect(writes).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/git/identity.test.ts`
Expected: FAIL ("Cannot find module './identity'").

- [ ] **Step 3: Implement identity.ts**

```ts
import { runGit } from "./run";

export interface GitIdentity {
  name: string;
  email: string;
}

type GitRun = (root: string, args: string[]) => Promise<string>;

// Set the repo-local user.name/user.email to `identity`, but only the fields
// that differ (idempotent; no needless writes). Reading a missing key throws in
// git, so treat that as "".
export async function ensureCommitIdentity(
  root: string,
  identity: GitIdentity,
  run: GitRun = runGit,
): Promise<void> {
  const read = async (key: string): Promise<string> => {
    try {
      return (await run(root, ["config", "--local", key])).trim();
    } catch {
      return "";
    }
  };
  if ((await read("user.name")) !== identity.name) {
    await run(root, ["config", "--local", "user.name", identity.name]);
  }
  if ((await read("user.email")) !== identity.email) {
    await run(root, ["config", "--local", "user.email", identity.email]);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/git/identity.test.ts` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/git/identity.ts packages/agent-core/src/git/identity.test.ts
git commit -m "feat(gh): ensureCommitIdentity sets per-repo author idempotently"
```

---

## Task 6: resolveProjectAccount (pure resolver)

**Files:**
- Create: `packages/agent-core/src/git/resolve.ts`
- Test: `packages/agent-core/src/git/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-core/src/git/resolve.test.ts`:

```ts
import { expect, it } from "vitest";
import type { GhAccount } from "../github/accounts";
import { parseRemote } from "./remote";
import { resolveProjectAccount } from "./resolve";

const accounts: GhAccount[] = [
  { host: "github.com", username: "RicardoRamosT", active: true },
  { host: "github.com", username: "vnricardotrevino", active: false },
];
const origin = (u: string) => parseRemote(u);

it("auto-detects the account whose login matches the origin owner", () => {
  const r = resolveProjectAccount(
    undefined,
    origin("https://github.com/RicardoRamosT/Airlock-IDE.git"),
    accounts,
  );
  expect(r).toEqual({
    account: { host: "github.com", username: "RicardoRamosT" },
    source: "auto",
    protocol: "https",
  });
});

it("returns none for an org repo with no matching login", () => {
  const r = resolveProjectAccount(
    undefined,
    origin("https://github.com/ViewNear/lend.git"),
    accounts,
  );
  expect(r.account).toBeNull();
  expect(r.source).toBe("none");
});

it("prefers a valid override over auto-detect", () => {
  const r = resolveProjectAccount(
    { host: "github.com", username: "vnricardotrevino" },
    origin("https://github.com/RicardoRamosT/Airlock-IDE.git"),
    accounts,
  );
  expect(r.account?.username).toBe("vnricardotrevino");
  expect(r.source).toBe("override");
});

it("ignores an override pointing at a logged-out account", () => {
  const r = resolveProjectAccount(
    { host: "github.com", username: "ghost" },
    origin("https://github.com/RicardoRamosT/x.git"),
    accounts,
  );
  expect(r.source).toBe("auto"); // falls through to auto
  expect(r.account?.username).toBe("RicardoRamosT");
});

it("reports ssh protocol and no remote", () => {
  expect(
    resolveProjectAccount(undefined, origin("git@github.com:RicardoRamosT/x.git"), accounts).protocol,
  ).toBe("ssh");
  expect(resolveProjectAccount(undefined, null, accounts)).toEqual({
    account: null,
    source: "none",
    protocol: "unknown",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/git/resolve.test.ts`
Expected: FAIL ("Cannot find module './resolve'").

- [ ] **Step 3: Implement resolve.ts**

```ts
import type { GhAccount } from "../github/accounts";
import type { ParsedRemote } from "./remote";

export interface ResolvedAccount {
  account: { host: string; username: string } | null;
  source: "override" | "auto" | "none";
  protocol: "https" | "ssh" | "unknown";
}

// Resolve a project's account: a valid override wins; else auto-detect by
// matching the origin owner to a logged-in login; else none. Pure -- the caller
// supplies the override (from config), the parsed origin, and gh accounts.
export function resolveProjectAccount(
  override: { host: string; username: string } | undefined,
  remote: ParsedRemote | null,
  accounts: GhAccount[],
): ResolvedAccount {
  const protocol = remote?.protocol ?? "unknown";
  const known = (host: string, username: string) =>
    accounts.some((a) => a.host === host && a.username === username);

  if (override && known(override.host, override.username)) {
    return { account: { ...override }, source: "override", protocol };
  }
  if (remote) {
    const match = accounts.find(
      (a) => a.host === remote.host && a.username === remote.owner,
    );
    if (match) {
      return {
        account: { host: match.host, username: match.username },
        source: "auto",
        protocol,
      };
    }
  }
  return { account: null, source: "none", protocol };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/git/resolve.test.ts` → PASS (5 tests).

- [ ] **Step 5: Export the new agent-core symbols**

In `packages/agent-core/src/index.ts`, add exports (match the file's existing `export ... from "./..."` style):

```ts
export { parseRemote, getOrigin, type ParsedRemote } from "./git/remote";
export { runGitAuthed, buildAuthedArgs } from "./git/auth";
export { ensureCommitIdentity, type GitIdentity } from "./git/identity";
export { resolveProjectAccount, type ResolvedAccount } from "./git/resolve";
export { ghToken, ghUserIdentity, parseGhUser, type GhIdentity } from "./github/accounts";
```

(If any symbol is already exported there, skip that one.)

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/git/resolve.ts packages/agent-core/src/git/resolve.test.ts packages/agent-core/src/index.ts
git commit -m "feat(gh): resolveProjectAccount (override > auto-detect > none)"
```

---

## Task 7: Route git ops through the resolver (ops + main wiring)

**Files:**
- Modify: `packages/agent-core/src/git/ops.ts`
- Create: `packages/app/src/main/github/account.ts`
- Modify: `packages/app/src/main/ipc.ts`

No dedicated test (electron/exec wiring; the pure pieces are covered by Tasks 2–6). Verified by typecheck + manual run.

- [ ] **Step 1: Add an optional token to the remote ops**

In `packages/agent-core/src/git/ops.ts`, add the import:

```ts
import { runGitAuthed } from "./auth";
```

Replace the three remote-op functions with token-aware versions (the local
rev-parse/symbolic-ref stay on `runGit` — they need no network/auth):

```ts
export async function gitFetch(root: string, token: string | null = null): Promise<void> {
  await runGitAuthed(root, token, ["fetch"]);
}

export async function gitPull(root: string, token: string | null = null): Promise<void> {
  await runGitAuthed(root, token, ["pull", "--ff-only"]);
}

export async function gitPush(root: string, token: string | null = null): Promise<void> {
  let hasUpstream = true;
  try {
    await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  } catch {
    hasUpstream = false;
  }
  if (hasUpstream) {
    await runGitAuthed(root, token, ["push"]);
    return;
  }
  let branch: string;
  try {
    branch = (await runGit(root, ["symbolic-ref", "--short", "HEAD"])).trim();
  } catch {
    throw new Error(
      "Cannot push: HEAD is detached (not on a branch). Switch to or create a branch first.",
    );
  }
  await runGitAuthed(root, token, ["push", "-u", "origin", branch]);
}
```

Run `npx vitest run packages/agent-core/src/git/ops.test.ts` → PASS (existing tests call these with one arg; the default `token=null` keeps them on plain runGit).

- [ ] **Step 2: Create the main-side resolver**

`packages/app/src/main/github/account.ts`:

```ts
import {
  ensureCommitIdentity,
  getOrigin,
  ghAccounts,
  ghToken,
  ghUserIdentity,
  parseRemote,
  resolveProjectAccount,
  type ResolvedAccount,
} from "@airlock/agent-core";
import { readProjectConfig } from "@airlock/agent-core";

// Resolve which account a project uses (override > auto > none) + its protocol.
export async function resolveFor(root: string): Promise<ResolvedAccount> {
  const [cfg, originUrl, gh] = await Promise.all([
    readProjectConfig(root),
    getOrigin(root),
    ghAccounts(),
  ]);
  return resolveProjectAccount(
    cfg.githubAccount,
    originUrl ? parseRemote(originUrl) : null,
    gh.accounts,
  );
}

// Token for the project's account, but only when injection applies (https).
// null => the caller runs the op with today's default behavior.
export async function tokenFor(root: string): Promise<string | null> {
  const r = await resolveFor(root);
  if (!r.account || r.protocol !== "https") return null;
  try {
    return await ghToken(r.account.host, r.account.username);
  } catch {
    return null; // logged out / no token -> fall back to default auth
  }
}

// Memoized identity per account (rarely changes within a session).
const identityCache = new Map<string, { name: string; email: string }>();

// Set the repo's commit identity to match its account. Best-effort: never throw.
export async function ensureIdentityFor(root: string): Promise<void> {
  try {
    const r = await resolveFor(root);
    if (!r.account) return;
    const key = `${r.account.host}/${r.account.username}`;
    let id = identityCache.get(key);
    if (!id && r.protocol === "https") {
      const token = await ghToken(r.account.host, r.account.username);
      id = await ghUserIdentity(r.account.host, r.account.username, token);
      identityCache.set(key, id);
    }
    if (id) await ensureCommitIdentity(root, id);
  } catch {
    // best-effort: identity stays as-is if gh/network is unavailable
  }
}
```

- [ ] **Step 3: Wire the IPC handlers**

In `packages/app/src/main/ipc.ts`, add the import:

```ts
import { ensureIdentityFor, resolveFor, tokenFor } from "./github/account";
```

Add `readProjectConfig` and `writeProjectConfig` to the existing
`@airlock/agent-core` import if not already imported (they are used below).

Replace the `git:commit`, `git:fetch`, `git:pull`, `git:push` handlers with:

```ts
  ipcMain.handle("git:commit", async (e, root: unknown, message: unknown) => {
    if (typeof message !== "string") throw new Error("Invalid payload");
    const resolved = resolveRoot(e, root);
    await ensureIdentityFor(resolved); // author commits as the project's account
    return guardedCommit(resolved, message, { gated: false });
  });

  ipcMain.handle("git:fetch", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    return gitFetch(resolved, await tokenFor(resolved));
  });
  ipcMain.handle("git:pull", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    return gitPull(resolved, await tokenFor(resolved));
  });
  ipcMain.handle("git:push", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    return gitPush(resolved, await tokenFor(resolved));
  });
```

Add two new handlers next to the existing `github:switch` handler:

```ts
  ipcMain.handle("github:resolveAccount", (e, root: unknown) =>
    resolveFor(resolveRoot(e, root)),
  );
  ipcMain.handle(
    "github:setProjectAccount",
    async (e, root: unknown, account: unknown) => {
      const resolved = resolveRoot(e, root);
      const acct =
        account &&
        typeof account === "object" &&
        typeof (account as { host?: unknown }).host === "string" &&
        typeof (account as { username?: unknown }).username === "string"
          ? {
              host: (account as { host: string }).host,
              username: (account as { username: string }).username,
            }
          : undefined; // null/invalid => clear the override (back to auto)
      await writeProjectConfig(resolved, { githubAccount: acct });
      await ensureIdentityFor(resolved); // apply the new account's identity now
    },
  );
```

- [ ] **Step 4: Verify compile + existing tests**

Run: `npm run typecheck` → PASS.
Run: `npx vitest run packages/agent-core/src/git/ops.test.ts` → PASS.
Run: `npx biome check --write packages/agent-core/src/git/ops.ts packages/app/src/main/github/account.ts packages/app/src/main/ipc.ts` then `npx biome check` on them → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/git/ops.ts packages/app/src/main/github/account.ts packages/app/src/main/ipc.ts
git commit -m "feat(gh): route push/pull/fetch through per-project token + identity on commit"
```

---

## Task 8: GitSection account readout + override

**Files:**
- Modify: `packages/app/src/renderer/src/components/GitSection.tsx`

No dedicated test (component wiring; mirrors the codebase's untested UI sections). Verified by typecheck + manual run.

- [ ] **Step 1: Add state + types**

In `packages/app/src/renderer/src/components/GitSection.tsx`, extend the type import and add state. Change the import line:

```ts
import type { GitStatus, ResolvedGithubAccount, SecretLeak } from "../../../shared/ipc";
```

Add near the other `useState` calls:

```ts
  const [account, setAccount] = useState<ResolvedGithubAccount | null>(null);
  const [accountList, setAccountList] = useState<string[]>([]);
```

- [ ] **Step 2: Fetch on refresh**

Inside the `refresh` callback, after `setBranches(...)` and before `setError(null)`, add:

```ts
      setAccount(await window.airlock.resolveGithubAccount(root));
      const info = await window.airlock.githubInfo();
      setAccountList(
        info.gh.accounts
          .filter((a) => a.host === "github.com")
          .map((a) => a.username),
      );
```

- [ ] **Step 3: Render the readout + override**

Add this block in the returned JSX, immediately after the `git-branch-row` div
(before `git-sync-row`):

```tsx
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
                className="git-account"
                value={account.source === "override" && account.account
                  ? account.account.username
                  : "__auto__"}
                onChange={(e) => {
                  const v = e.target.value;
                  void run(() =>
                    window.airlock.setProjectGithubAccount(
                      root,
                      v === "__auto__" ? null : { host: "github.com", username: v },
                    ),
                  );
                }}
              >
                <option value="__auto__">
                  Auto{account.source !== "override" && account.account
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
```

- [ ] **Step 4: Add styles**

In `packages/app/src/renderer/src/theme.css`, add near the other `.git-*` rules:

```css
.git-account-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 12px;
  color: var(--fg-dim);
}
.git-account-label {
  color: var(--fg-dim);
}
.git-account {
  flex: 1;
  min-width: 0;
  background: var(--bg-panel);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 4px;
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck` → PASS.
Run: `npx vitest run packages/app/src/renderer/src/components/GitSection.sync.test.tsx` → PASS (existing test still green; if its `window.airlock` stub lacks `resolveGithubAccount`/`githubInfo`, add minimal stubs returning `{account:null,source:"none",protocol:"unknown"}` and `{gh:{installed:true,accounts:[]},identity:{name:null,email:null}}` the same way the stub defines other methods).
Run: `npx biome check --write packages/app/src/renderer/src/components/GitSection.tsx packages/app/src/renderer/src/theme.css` then `npx biome check` on them → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/src/components/GitSection.tsx packages/app/src/renderer/src/theme.css packages/app/src/renderer/src/components/GitSection.sync.test.tsx
git commit -m "feat(gh): Git section shows + overrides the project's push account"
```

---

## Task 9: Full verification + review

**Files:** none (verification only).

- [ ] **Step 1: Full suite + gates**

Run: `npm test` → all pass (incl. new remote/auth/identity/resolve/accounts/config tests).
Run: `npm run typecheck` → PASS.
Run: `npm run lint` → exit 0 (fix with `npx biome check --write .` and re-commit if needed).

- [ ] **Step 2: Manual smoke (real app)**

Run: `npm run dev`. With two projects open whose `origin`s belong to different
accounts (e.g. a `RicardoRamosT/*` repo and a `ViewNear/*` repo):
1. Git section shows `push as: RicardoRamosT (auto)` for the personal repo.
2. For the org repo it shows `Auto (none — pick one)`; pick `vnricardotrevino`;
   confirm it persists to that project's `.airlock/config.json` (`githubAccount`).
3. Make a commit in each → `git log -1 --format='%an <%ae>'` shows each repo's
   account identity.
4. Push each (e.g. to a test branch) without `gh auth switch` in between — both
   authenticate as their own account. Confirm `~/.claude` / global active account
   is unchanged (`gh auth status` active account is whatever it was).
5. An SSH-remote repo shows "SSH remote — uses your keys" and pushes as before.

- [ ] **Step 3: Final review + commit any fixes**

```bash
git add -A
git commit -m "chore(gh): lint/format pass"   # only if needed
```

---

## Self-Review (completed during planning)

**Spec coverage:** mechanism/token-injection (Tasks 4,7) · resolution override>auto>none (Task 6) · auto-detect from origin owner (Tasks 2,6) · persisted override + clear (Tasks 1,7) · commit identity via gh, set before commit + on pick (Tasks 3,5,7) · https-only / SSH fallback (Tasks 4,6,7,8) · UI readout+override (Task 8) · token main-side/env-only, no disk, no global switch (Tasks 4,7) · tests for pure modules (Tasks 2–6) — all mapped. PR-auth/terminal/multi-host-noreply intentionally deferred (spec non-goals); noted, not gaps.

**Placeholder scan:** none — every code step is complete. The two "if the stub lacks X" notes (Tasks 7-era preload already handled in Task 1; GitSection.sync stub) are concrete fallbacks with exact values.

**Type consistency:** `ResolvedAccount` (agent-core) vs `ResolvedGithubAccount` (shared/ipc) are deliberately the same shape — the `github:resolveAccount` handler returns `ResolvedAccount` which structurally satisfies `ResolvedGithubAccount` (both `{account:{host,username}|null, source, protocol}`). `{host, username}` account shape, `GitIdentity {name,email}`, and `githubAccount` config field are consistent across tasks. `gitFetch/gitPull/gitPush(root, token?)` signatures match between ops.ts (Task 7) and the handlers (Task 7).
