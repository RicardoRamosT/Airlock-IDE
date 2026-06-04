# Airlock Phase A: Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Secrets live in the macOS Keychain and are injected into terminal sessions at spawn — no `.env` on disk. Sidebar Secrets section (add/update/delete via secure modal, import-from-.env), per-project inject toggle, hash-chained audit log of every broker operation.

**Architecture:** All secret/audit logic lives in `agent-core` (`broker/`, `audit/`, `project/`) behind the existing public API surface. Values are write-only: no agent-core API, IPC channel, or renderer state ever returns a stored value — the renderer sends a value exactly once (modal submit) and only metadata flows back. The keychain is injected as a dependency (`KeychainStore` interface) so tests use an in-memory fake and never touch the real Keychain.

**Tech Stack additions:** `@napi-rs/keyring` (agent-core dep). Everything else is already installed.

**Spec:** `docs/superpowers/specs/2026-06-03-airlock-v1-design.md` §6 (broker), §9 (modal/sidebar), approved Phase-A scope (chat, 2026-06-03): standalone secrets WITHOUT the agent; redactor/`request_secret`/export-to-.env deferred.

**CRITICAL reminder for every agent-core file in this plan:** ASCII-only comments (no §, ©, arrows, ellipsis). agent-core is bundled into the Electron CJS main and Electron's cjs_lexer asserts on multibyte chars (see tree.ts note / commit 4a3beb2).

---

## File structure (additions)

```text
packages/agent-core/src/
  project/
    id.ts                # projectIdFor(root): "basename-sha8"
    id.test.ts
    config.ts            # .airlock/config.json read/write (injectSecretsIntoTerminal)
    config.test.ts
  broker/
    keychain.ts          # KeychainStore interface + systemKeychain (@napi-rs/keyring)
    validators.ts        # provider pattern table (pure)
    validators.test.ts
    dotenv.ts            # parseDotEnv (pure)
    dotenv.test.ts
    meta.ts              # .airlock/secrets.json names+meta index (never values)
    meta.test.ts
    broker.ts            # setSecret/deleteSecret/listSecrets/injectInto/importDotEnv
    broker.test.ts       # fake keychain + tmpdir
  audit/
    audit.ts             # hash-chained JSONL append/read/verify
    audit.test.ts
  index.ts               # MODIFIED: new exports

packages/app/src/
  shared/ipc.ts          # MODIFIED: secrets/config/audit channels + types
  main/ipc.ts            # MODIFIED: new handlers + pty:create injection
  preload/index.ts       # MODIFIED: new API methods
  renderer/src/
    store.ts             # MODIFIED: secrets, config, termNonce
    App.tsx              # MODIFIED: TerminalPane key includes termNonce
    theme.css            # MODIFIED: secrets/modal/audit styles
    components/
      Sidebar.tsx        # MODIFIED: live Secrets + Audit sections
      SecretsSection.tsx # list, toggle, import, restart hint
      SecretModal.tsx    # masked input, validation feedback on submit
      AuditSection.tsx   # last N audit entries
```

---

### Task 1: Dependency + spec amendment

**Files:**
- Modify: `docs/superpowers/specs/2026-06-03-airlock-v1-design.md`
- Modify: `packages/agent-core/package.json` (via npm install)

- [ ] **Step 1: Install the keychain dependency**

```bash
cd /Users/ricardoramos/Projects/airlock
npm install @napi-rs/keyring -w @airlock/agent-core
```

Expected: installs clean (it ships prebuilt binaries; no node-gyp run).

- [ ] **Step 2: Verify the installed API surface**

Run: `cat node_modules/@napi-rs/keyring/index.d.ts | head -40`
Expected: an `Entry` class constructed with `(service, username)` exposing password get/set/delete methods. Note the EXACT method names (e.g. `getPassword`/`setPassword`/`deletePassword` or similar) — Task 6 must match them.

- [ ] **Step 3: Amend the spec roadmap**

In `docs/superpowers/specs/2026-06-03-airlock-v1-design.md` §12, add directly under the roadmap table:

```markdown
> *Revised 2026-06-03 after skeleton-v0.1 shipped: the owner reordered the
> roadmap — Phase A (standalone secrets: broker + keychain + terminal
> injection + import-from-.env + audit v0, NO agent yet) and Phase B (git
> sidebar) come before the agent. The redactor and request_secret remain
> tied to the agent phase. Spec section 6 architecture is unchanged; the
> broker simply gains a user-facing consumer (terminal injection) before
> its agent-facing one.*
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add @napi-rs/keyring; spec roadmap reordered (secrets+git before agent)"
```

---

### Task 2: Project identity (TDD)

**Files:**
- Test: `packages/agent-core/src/project/id.test.ts`
- Create: `packages/agent-core/src/project/id.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectIdFor } from "./id";

describe("projectIdFor", () => {
  it("combines basename with an 8-char hash", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-id-"));
    const id = await projectIdFor(root);
    expect(id).toMatch(new RegExp(`^${path.basename(root)}-[0-9a-f]{8}$`));
  });

  it("is stable for the same path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-id-"));
    expect(await projectIdFor(root)).toBe(await projectIdFor(root));
  });

  it("differs for different paths with the same basename", async () => {
    const a = await mkdtemp(path.join(tmpdir(), "airlock-id-"));
    const b = await mkdtemp(path.join(tmpdir(), "airlock-id-"));
    const sameNameA = path.join(a, "proj");
    const sameNameB = path.join(b, "proj");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sameNameA);
    await mkdir(sameNameB);
    expect(await projectIdFor(sameNameA)).not.toBe(await projectIdFor(sameNameB));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/project/id.test.ts`
Expected: FAIL — cannot resolve `./id`.

- [ ] **Step 3: Implement `id.ts`**

```ts
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Stable per-project identity: "<basename>-<sha256(realpath) first 8 hex>".
 * Used to scope keychain accounts so equally-named projects do not collide.
 */
export async function projectIdFor(root: string): Promise<string> {
  const real = await realpath(path.resolve(root));
  const hash = createHash("sha256").update(real).digest("hex").slice(0, 8);
  return `${path.basename(real)}-${hash}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/project/id.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/project
git commit -m "feat(agent-core): stable project identity for keychain scoping (TDD)"
```

---

### Task 3: Secret validators (TDD)

**Files:**
- Test: `packages/agent-core/src/broker/validators.test.ts`
- Create: `packages/agent-core/src/broker/validators.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { validateSecret, validateSecretName } from "./validators";

describe("validateSecretName", () => {
  it.each(["DATABASE_URL", "STRIPE_SECRET_KEY", "_X", "a1"])("accepts %s", (n) => {
    expect(validateSecretName(n)).toBe(true);
  });
  it.each(["1BAD", "WITH SPACE", "DASH-ED", ""])("rejects %s", (n) => {
    expect(validateSecretName(n)).toBe(false);
  });
});

describe("validateSecret", () => {
  it("detects Stripe secret keys", () => {
    const r = validateSecret("STRIPE_SECRET_KEY", "sk_test_4eC39HqLyjWDarjtT1zdp7dc");
    expect(r.provider).toBe("stripe-secret");
    expect(r.valid).toBe(true);
  });

  it("flags a publishable key as public", () => {
    const r = validateSecret("STRIPE_KEY", "pk_test_TYooMQauvdEDq54NiTphI7jx");
    expect(r.provider).toBe("stripe-publishable");
    expect(r.valid).toBe(true);
    expect(r.hint).toMatch(/public/i);
  });

  it("detects AWS access key ids", () => {
    expect(validateSecret("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE").provider).toBe(
      "aws-access-key-id",
    );
  });

  it("detects GitHub tokens", () => {
    const r = validateSecret("GH", `ghp_${"a".repeat(36)}`);
    expect(r.provider).toBe("github-token");
  });

  it("detects postgres URLs with credentials", () => {
    const r = validateSecret("DATABASE_URL", "postgresql://user:pass@host:5432/db");
    expect(r.provider).toBe("postgres-url");
    expect(r.valid).toBe(true);
  });

  it("detects PEM private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
    expect(validateSecret("SNOWFLAKE_KEY", pem).provider).toBe("pem-private-key");
  });

  it("detects JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dQw4w9WgXcQ";
    expect(validateSecret("TOKEN", jwt).provider).toBe("jwt");
  });

  it("detects Anthropic keys", () => {
    expect(validateSecret("ANTHROPIC_API_KEY", `sk-ant-${"x".repeat(24)}`).provider).toBe(
      "anthropic-api-key",
    );
  });

  it("warns when the name promises Stripe but the value does not", () => {
    const r = validateSecret("STRIPE_SECRET_KEY", "not-a-stripe-key");
    expect(r.valid).toBe(false);
    expect(r.hint).toMatch(/sk_/);
  });

  it("rejects empty values", () => {
    expect(validateSecret("X", "  ").valid).toBe(false);
  });

  it("accepts unknown formats as valid with no provider", () => {
    const r = validateSecret("MY_CUSTOM_TOKEN", "whatever-opaque-string");
    expect(r).toEqual({ provider: null, valid: true, hint: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/broker/validators.test.ts`
Expected: FAIL — cannot resolve `./validators`.

- [ ] **Step 3: Implement `validators.ts`**

```ts
export interface ValidationResult {
  provider: string | null;
  valid: boolean;
  hint: string | null;
}

interface ProviderPattern {
  provider: string;
  pattern: RegExp;
  hint: string | null;
}

const PROVIDERS: ProviderPattern[] = [
  {
    provider: "stripe-secret",
    pattern: /^sk_(live|test)_[A-Za-z0-9]{16,}$/,
    hint: "Stripe secret key",
  },
  {
    provider: "stripe-publishable",
    pattern: /^pk_(live|test)_[A-Za-z0-9]{16,}$/,
    hint: "Stripe publishable key - this one is public, not secret",
  },
  {
    provider: "aws-access-key-id",
    pattern: /^(AKIA|ASIA)[A-Z0-9]{16}$/,
    hint: "AWS access key ID",
  },
  {
    provider: "github-token",
    pattern: /^gh[pousr]_[A-Za-z0-9]{36,}$/,
    hint: "GitHub token",
  },
  {
    provider: "slack-token",
    pattern: /^xox[bpars]-[A-Za-z0-9-]{10,}$/,
    hint: "Slack token",
  },
  {
    provider: "anthropic-api-key",
    pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    hint: "Anthropic API key",
  },
  {
    provider: "postgres-url",
    pattern: /^postgres(ql)?:\/\/[^:@\s]+:[^@\s]+@.+/,
    hint: "Postgres connection URL with embedded credentials",
  },
  {
    provider: "pem-private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    hint: "PEM private key block",
  },
  {
    provider: "jwt",
    pattern: /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    hint: "JSON Web Token",
  },
];

export function validateSecretName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function validateSecret(name: string, value: string): ValidationResult {
  const v = value.trim();
  if (v.length === 0) return { provider: null, valid: false, hint: "Value is empty" };

  for (const p of PROVIDERS) {
    if (p.pattern.test(v)) return { provider: p.provider, valid: true, hint: p.hint };
  }

  // Name-promises-format mismatches the patterns above did not catch.
  if (/STRIPE_SECRET/i.test(name) && !v.startsWith("sk_")) {
    return {
      provider: "stripe-secret",
      valid: false,
      hint: "Name suggests a Stripe secret key, but the value does not start with sk_",
    };
  }
  if (/^AWS_SECRET/i.test(name) && v.length !== 40) {
    return {
      provider: "aws-secret-access-key",
      valid: false,
      hint: "AWS secret access keys are exactly 40 characters",
    };
  }

  return { provider: null, valid: true, hint: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/broker/validators.test.ts`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/broker
git commit -m "feat(agent-core): provider-aware secret validation (TDD)"
```

---

### Task 4: dotenv parser (TDD)

**Files:**
- Test: `packages/agent-core/src/broker/dotenv.test.ts`
- Create: `packages/agent-core/src/broker/dotenv.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseDotEnv } from "./dotenv";

describe("parseDotEnv", () => {
  it("parses plain pairs, skipping comments and blanks", () => {
    const text = ["# comment", "", "FOO=bar", "BAZ=qux"].join("\n");
    expect(parseDotEnv(text)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("handles export prefix and surrounding whitespace", () => {
    expect(parseDotEnv("export KEY = value")).toEqual({ KEY: "value" });
  });

  it("unquotes double quotes and unescapes newlines", () => {
    expect(parseDotEnv('PEM="line1\\nline2"')).toEqual({ PEM: "line1\nline2" });
  });

  it("unquotes single quotes literally", () => {
    expect(parseDotEnv("A='has \\n literal'")).toEqual({ A: "has \\n literal" });
  });

  it("strips trailing comments from unquoted values only", () => {
    expect(parseDotEnv("A=value # note")).toEqual({ A: "value" });
    expect(parseDotEnv('B="value # not a comment"')).toEqual({ B: "value # not a comment" });
  });

  it("ignores malformed lines and invalid names", () => {
    expect(parseDotEnv("not a pair\n1BAD=x\nGOOD=1")).toEqual({ GOOD: "1" });
  });

  it("keeps the last occurrence of duplicate keys", () => {
    expect(parseDotEnv("A=1\nA=2")).toEqual({ A: "2" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/broker/dotenv.test.ts`
Expected: FAIL — cannot resolve `./dotenv`.

- [ ] **Step 3: Implement `dotenv.ts`**

```ts
/**
 * Minimal .env parser for import-to-keychain. Supports comments, export
 * prefix, single/double quotes, and backslash-n unescaping inside double
 * quotes. Deliberately NOT a full dotenv implementation (no multiline
 * quoted blocks spanning physical lines) - good enough for real .env files,
 * and anything it cannot parse is simply skipped, never corrupted.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (!key) continue;
    let val = m[2] ?? "";
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(" #");
      if (hash !== -1) val = val.slice(0, hash);
      val = val.trim();
    }
    out[key] = val;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/broker/dotenv.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/broker
git commit -m "feat(agent-core): minimal dotenv parser for keychain import (TDD)"
```

---

### Task 5: Hash-chained audit log (TDD)

**Files:**
- Test: `packages/agent-core/src/audit/audit.test.ts`
- Create: `packages/agent-core/src/audit/audit.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAudit, readAudit, verifyAuditChain } from "./audit";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-audit-"));
});

describe("audit", () => {
  it("appends entries with a verifiable hash chain", async () => {
    await appendAudit(root, "user", "secret.set", { name: "A" });
    await appendAudit(root, "user", "secret.set", { name: "B" });
    await appendAudit(root, "user", "secret.inject", { names: ["A", "B"] });
    const entries = await readAudit(root);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.op).toBe("secret.set");
    expect(entries[2]?.detail).toEqual({ names: ["A", "B"] });
    expect(await verifyAuditChain(root)).toBe(true);
  });

  it("links each entry to the previous hash", async () => {
    const a = await appendAudit(root, "user", "x", {});
    const b = await appendAudit(root, "user", "y", {});
    expect(b.prevHash).toBe(a.hash);
  });

  it("detects tampering", async () => {
    await appendAudit(root, "user", "secret.set", { name: "A" });
    await appendAudit(root, "user", "secret.delete", { name: "A" });
    const file = path.join(root, ".airlock", "audit", "log.jsonl");
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    const first = lines[0];
    if (!first) throw new Error("fixture broken");
    lines[0] = first.replace("secret.set", "secret.del");
    await writeFile(file, `${lines.join("\n")}\n`);
    expect(await verifyAuditChain(root)).toBe(false);
  });

  it("reads an empty log as no entries with a valid chain", async () => {
    expect(await readAudit(root)).toEqual([]);
    expect(await verifyAuditChain(root)).toBe(true);
  });

  it("limits reads from the tail", async () => {
    for (let i = 0; i < 5; i++) await appendAudit(root, "user", `op${i}`, {});
    const tail = await readAudit(root, 2);
    expect(tail.map((e) => e.op)).toEqual(["op3", "op4"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/audit/audit.test.ts`
Expected: FAIL — cannot resolve `./audit`.

- [ ] **Step 3: Implement `audit.ts`**

```ts
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface AuditEntry {
  ts: string;
  actor: "user" | "agent";
  op: string;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function auditFile(root: string): string {
  return path.join(root, ".airlock", "audit", "log.jsonl");
}

function computeHash(e: Omit<AuditEntry, "hash">): string {
  const body = JSON.stringify({
    ts: e.ts,
    actor: e.actor,
    op: e.op,
    detail: e.detail,
    prevHash: e.prevHash,
  });
  return createHash("sha256").update(body).digest("hex");
}

async function readEntries(root: string): Promise<AuditEntry[]> {
  let text: string;
  try {
    text = await readFile(auditFile(root), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as AuditEntry);
}

export async function appendAudit(
  root: string,
  actor: AuditEntry["actor"],
  op: string,
  detail: Record<string, unknown>,
  nowIso?: string,
): Promise<AuditEntry> {
  const entries = await readEntries(root);
  const prevHash = entries.length > 0 ? (entries[entries.length - 1]?.hash ?? GENESIS) : GENESIS;
  const partial = {
    ts: nowIso ?? new Date().toISOString(),
    actor,
    op,
    detail,
    prevHash,
  };
  const entry: AuditEntry = { ...partial, hash: computeHash(partial) };
  await mkdir(path.dirname(auditFile(root)), { recursive: true });
  await appendFile(auditFile(root), `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readAudit(root: string, limit?: number): Promise<AuditEntry[]> {
  const entries = await readEntries(root);
  if (limit === undefined || entries.length <= limit) return entries;
  return entries.slice(entries.length - limit);
}

export async function verifyAuditChain(root: string): Promise<boolean> {
  const entries = await readEntries(root);
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev) return false;
    const { hash, ...rest } = e;
    if (computeHash(rest) !== hash) return false;
    prev = hash;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/audit/audit.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/audit
git commit -m "feat(agent-core): hash-chained append-only audit log (TDD)"
```

---

### Task 6: Keychain wrapper + meta index (TDD)

**Files:**
- Create: `packages/agent-core/src/broker/keychain.ts`
- Test: `packages/agent-core/src/broker/meta.test.ts`
- Create: `packages/agent-core/src/broker/meta.ts`

- [ ] **Step 1: Write `keychain.ts`** (interface + system impl; the system impl is NOT unit-tested — it is a 6-line adapter over a native module, exercised at the human gate)

```ts
import { Entry } from "@napi-rs/keyring";

/**
 * Indirection over the OS keychain so the broker is testable with an
 * in-memory fake. The system implementation talks to the macOS Keychain.
 */
export interface KeychainStore {
  set(service: string, account: string, value: string): void;
  get(service: string, account: string): string | null;
  delete(service: string, account: string): boolean;
}

export const systemKeychain: KeychainStore = {
  set(service, account, value) {
    new Entry(service, account).setPassword(value);
  },
  get(service, account) {
    try {
      return new Entry(service, account).getPassword();
    } catch {
      return null;
    }
  },
  delete(service, account) {
    try {
      return new Entry(service, account).deletePassword();
    } catch {
      return false;
    }
  },
};
```

NOTE: match the method names you verified in Task 1 Step 2 (`deletePassword` vs `deleteCredential` etc. differ across versions). Mechanical adaptation sanctioned; the `KeychainStore` interface must stay exactly as written.

- [ ] **Step 2: Write the failing meta test**

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readMeta, removeMeta, upsertMeta } from "./meta";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-meta-"));
});

const metaA = {
  name: "A",
  provider: null,
  valid: true,
  createdAt: "2026-06-03T00:00:00.000Z",
  updatedAt: "2026-06-03T00:00:00.000Z",
};

describe("secrets meta index", () => {
  it("reads empty when missing", async () => {
    expect(await readMeta(root)).toEqual([]);
  });

  it("upserts and persists", async () => {
    await upsertMeta(root, metaA);
    expect(await readMeta(root)).toEqual([metaA]);
    const updated = { ...metaA, provider: "jwt", updatedAt: "2026-06-04T00:00:00.000Z" };
    await upsertMeta(root, updated);
    expect(await readMeta(root)).toEqual([updated]);
  });

  it("sorts by name and removes", async () => {
    await upsertMeta(root, { ...metaA, name: "ZZ" });
    await upsertMeta(root, { ...metaA, name: "AA" });
    expect((await readMeta(root)).map((m) => m.name)).toEqual(["AA", "ZZ"]);
    await removeMeta(root, "AA");
    expect((await readMeta(root)).map((m) => m.name)).toEqual(["ZZ"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/broker/meta.test.ts`
Expected: FAIL — cannot resolve `./meta`.

- [ ] **Step 4: Implement `meta.ts`**

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Names and metadata ONLY. Secret values never appear in this file. */
export interface SecretMeta {
  name: string;
  provider: string | null;
  valid: boolean;
  createdAt: string;
  updatedAt: string;
}

function metaFile(root: string): string {
  return path.join(root, ".airlock", "secrets.json");
}

export async function readMeta(root: string): Promise<SecretMeta[]> {
  try {
    const text = await readFile(metaFile(root), "utf8");
    return JSON.parse(text) as SecretMeta[];
  } catch {
    return [];
  }
}

async function writeMetaList(root: string, list: SecretMeta[]): Promise<void> {
  const file = metaFile(root);
  await mkdir(path.dirname(file), { recursive: true });
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export async function upsertMeta(root: string, meta: SecretMeta): Promise<void> {
  const list = await readMeta(root);
  const next = list.filter((m) => m.name !== meta.name);
  next.push(meta);
  await writeMetaList(root, next);
}

export async function removeMeta(root: string, name: string): Promise<void> {
  const list = await readMeta(root);
  await writeMetaList(
    root,
    list.filter((m) => m.name !== name),
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/broker/meta.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/broker
git commit -m "feat(agent-core): keychain store interface + secrets meta index (TDD)"
```

---

### Task 7: The broker (TDD) + public API

**Files:**
- Test: `packages/agent-core/src/broker/broker.test.ts`
- Create: `packages/agent-core/src/broker/broker.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readAudit } from "../audit/audit";
import type { KeychainStore } from "./keychain";
import {
  deleteSecret,
  importDotEnv,
  injectInto,
  listSecrets,
  setSecret,
} from "./broker";

let root: string;
let store: Map<string, string>;
let fake: KeychainStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-broker-"));
  store = new Map();
  fake = {
    set: (s, a, v) => void store.set(`${s}|${a}`, v),
    get: (s, a) => store.get(`${s}|${a}`) ?? null,
    delete: (s, a) => store.delete(`${s}|${a}`),
  };
});

describe("broker", () => {
  it("stores a secret in the keychain, never in the meta file", async () => {
    const meta = await setSecret(root, "DATABASE_URL", "postgresql://u:hunter2@h/db", {
      keychain: fake,
    });
    expect(meta.provider).toBe("postgres-url");
    expect(meta.valid).toBe(true);
    expect([...store.values()]).toContain("postgresql://u:hunter2@h/db");
    const metaText = await readFile(path.join(root, ".airlock", "secrets.json"), "utf8");
    expect(metaText).not.toContain("hunter2");
  });

  it("rejects invalid names", async () => {
    await expect(setSecret(root, "BAD NAME", "v", { keychain: fake })).rejects.toThrow(
      /invalid secret name/i,
    );
  });

  it("lists metadata only and deletes everywhere", async () => {
    await setSecret(root, "A", "value-a", { keychain: fake });
    await setSecret(root, "B", "value-b", { keychain: fake });
    const list = await listSecrets(root);
    expect(list.map((m) => m.name)).toEqual(["A", "B"]);
    await deleteSecret(root, "A", { keychain: fake });
    expect((await listSecrets(root)).map((m) => m.name)).toEqual(["B"]);
    expect(store.size).toBe(1);
  });

  it("injects stored values over a base env", async () => {
    await setSecret(root, "FOO", "secret-foo", { keychain: fake });
    await setSecret(root, "BAR", "secret-bar", { keychain: fake });
    const r = await injectInto(root, { PATH: "/bin", FOO: "overridden" }, { keychain: fake });
    expect(r.env).toEqual({ PATH: "/bin", FOO: "secret-foo", BAR: "secret-bar" });
    expect(r.injected.sort()).toEqual(["BAR", "FOO"]);
  });

  it("skips keychain-missing values on inject without failing", async () => {
    await setSecret(root, "GONE", "x", { keychain: fake });
    store.clear();
    const r = await injectInto(root, {}, { keychain: fake });
    expect(r.env).toEqual({});
    expect(r.missing).toEqual(["GONE"]);
  });

  it("imports a .env file and can delete it after", async () => {
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "A=1\nB=2\n# c\n1BAD=x\n");
    const result = await importDotEnv(root, ".env", { keychain: fake, deleteAfter: true });
    expect(result.imported.map((m) => m.name)).toEqual(["A", "B"]);
    expect(result.skipped).toEqual([]);
    expect(result.deleted).toBe(true);
    await expect(stat(envPath)).rejects.toThrow();
  });

  it("audits set, delete, inject, and import operations", async () => {
    await setSecret(root, "A", "1", { keychain: fake });
    await deleteSecret(root, "A", { keychain: fake });
    await injectInto(root, {}, { keychain: fake });
    const ops = (await readAudit(root)).map((e) => e.op);
    expect(ops).toEqual(["secret.set", "secret.delete", "secret.inject"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/broker/broker.test.ts`
Expected: FAIL — cannot resolve `./broker`.

- [ ] **Step 3: Implement `broker.ts`**

```ts
import { readFile, unlink } from "node:fs/promises";
import { appendAudit } from "../audit/audit";
import { projectIdFor } from "../project/id";
import { resolveWithin } from "../workspace/tree";
import { parseDotEnv } from "./dotenv";
import { type KeychainStore, systemKeychain } from "./keychain";
import { type SecretMeta, readMeta, removeMeta, upsertMeta } from "./meta";
import { validateSecret, validateSecretName } from "./validators";

const SERVICE = "airlock";

export interface BrokerOptions {
  keychain?: KeychainStore;
}

async function accountFor(root: string, name: string): Promise<string> {
  return `${await projectIdFor(root)}:${name}`;
}

export async function setSecret(
  root: string,
  name: string,
  value: string,
  opts: BrokerOptions = {},
): Promise<SecretMeta> {
  const keychain = opts.keychain ?? systemKeychain;
  if (!validateSecretName(name)) throw new Error(`Invalid secret name: ${name}`);
  const validation = validateSecret(name, value);
  const existing = (await readMeta(root)).find((m) => m.name === name);
  const now = new Date().toISOString();
  keychain.set(SERVICE, await accountFor(root, name), value);
  const meta: SecretMeta = {
    name,
    provider: validation.provider,
    valid: validation.valid,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await upsertMeta(root, meta);
  await appendAudit(root, "user", "secret.set", {
    name,
    provider: validation.provider,
    valid: validation.valid,
  });
  return meta;
}

export async function deleteSecret(
  root: string,
  name: string,
  opts: BrokerOptions = {},
): Promise<void> {
  const keychain = opts.keychain ?? systemKeychain;
  keychain.delete(SERVICE, await accountFor(root, name));
  await removeMeta(root, name);
  await appendAudit(root, "user", "secret.delete", { name });
}

export async function listSecrets(root: string): Promise<SecretMeta[]> {
  return readMeta(root);
}

export interface InjectResult {
  env: Record<string, string>;
  injected: string[];
  missing: string[];
}

export async function injectInto(
  root: string,
  base: Record<string, string>,
  opts: BrokerOptions = {},
): Promise<InjectResult> {
  const keychain = opts.keychain ?? systemKeychain;
  const env = { ...base };
  const injected: string[] = [];
  const missing: string[] = [];
  for (const meta of await readMeta(root)) {
    const value = keychain.get(SERVICE, await accountFor(root, meta.name));
    if (value === null) {
      missing.push(meta.name);
      continue;
    }
    env[meta.name] = value;
    injected.push(meta.name);
  }
  await appendAudit(root, "user", "secret.inject", {
    names: injected,
    missing,
    count: injected.length,
  });
  return { env, injected, missing };
}

export interface ImportResult {
  imported: SecretMeta[];
  skipped: string[];
  deleted: boolean;
}

export async function importDotEnv(
  root: string,
  relPath: string,
  opts: BrokerOptions & { deleteAfter?: boolean } = {},
): Promise<ImportResult> {
  const abs = await resolveWithin(root, relPath);
  const text = await readFile(abs, "utf8");
  const pairs = parseDotEnv(text);
  const imported: SecretMeta[] = [];
  const skipped: string[] = [];
  for (const [name, value] of Object.entries(pairs)) {
    if (!validateSecretName(name) || value.length === 0) {
      skipped.push(name);
      continue;
    }
    imported.push(await setSecret(root, name, value, opts));
  }
  let deleted = false;
  if (opts.deleteAfter && imported.length > 0) {
    await unlink(abs);
    deleted = true;
  }
  await appendAudit(root, "user", "secret.import", {
    file: relPath,
    imported: imported.map((m) => m.name),
    skipped,
    deleted,
  });
  return { imported, skipped, deleted };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/broker/broker.test.ts`
Expected: 7 passed. (Note: `secret.import` audits AFTER the per-secret `secret.set` entries — the audit-ops test in Step 1 only covers set/delete/inject ordering.)

- [ ] **Step 5: Export the new surface from `index.ts`** — append:

```ts
export { projectIdFor } from "./project/id";
export {
  validateSecret,
  validateSecretName,
  type ValidationResult,
} from "./broker/validators";
export { parseDotEnv } from "./broker/dotenv";
export { type KeychainStore, systemKeychain } from "./broker/keychain";
export { type SecretMeta } from "./broker/meta";
export {
  setSecret,
  deleteSecret,
  listSecrets,
  injectInto,
  importDotEnv,
  type InjectResult,
  type ImportResult,
  type BrokerOptions,
} from "./broker/broker";
export {
  appendAudit,
  readAudit,
  verifyAuditChain,
  type AuditEntry,
} from "./audit/audit";
```

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npx tsc -p packages/agent-core --noEmit`
Expected: 56 tests passed (23 prior + 3 id + 15 validators + 7 dotenv + 5 audit + 3 meta = 56... recount at runtime; the exact total is whatever vitest reports with ALL green), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src
git commit -m "feat(agent-core): keychain broker — set/delete/list/inject/import, audited (TDD)"
```

---

### Task 8: Project config + IPC + terminal injection

**Files:**
- Test: `packages/agent-core/src/project/config.test.ts`
- Create: `packages/agent-core/src/project/config.ts`
- Modify: `packages/agent-core/src/index.ts`
- Modify: `packages/app/src/shared/ipc.ts`
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`

- [ ] **Step 1: Write the failing config test**

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectConfig, writeProjectConfig } from "./config";

describe("project config", () => {
  it("defaults injectSecretsIntoTerminal to false", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    expect(await readProjectConfig(root)).toEqual({ injectSecretsIntoTerminal: false });
  });

  it("persists patches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    const next = await writeProjectConfig(root, { injectSecretsIntoTerminal: true });
    expect(next.injectSecretsIntoTerminal).toBe(true);
    expect(await readProjectConfig(root)).toEqual({ injectSecretsIntoTerminal: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/project/config.test.ts`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 3: Implement `config.ts`**

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ProjectConfig {
  injectSecretsIntoTerminal: boolean;
}

const DEFAULTS: ProjectConfig = { injectSecretsIntoTerminal: false };

function configFile(root: string): string {
  return path.join(root, ".airlock", "config.json");
}

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  try {
    const text = await readFile(configFile(root), "utf8");
    return { ...DEFAULTS, ...(JSON.parse(text) as Partial<ProjectConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeProjectConfig(
  root: string,
  patch: Partial<ProjectConfig>,
): Promise<ProjectConfig> {
  const next = { ...(await readProjectConfig(root)), ...patch };
  await mkdir(path.dirname(configFile(root)), { recursive: true });
  await writeFile(configFile(root), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes; export from index.ts**

Run: `npx vitest run packages/agent-core/src/project/config.test.ts` → 2 passed.
Append to `packages/agent-core/src/index.ts`:

```ts
export {
  readProjectConfig,
  writeProjectConfig,
  type ProjectConfig,
} from "./project/config";
```

- [ ] **Step 5: Extend `shared/ipc.ts`** — add imports/re-exports and API methods:

```ts
import type {
  AuditEntry,
  DirEntry,
  FileContent,
  ImportResult,
  ProjectConfig,
  SecretMeta,
} from "@airlock/agent-core";

export type { AuditEntry, DirEntry, FileContent, ImportResult, ProjectConfig, SecretMeta };
```

(keep PtyDataEvent/PtyExitEvent as-is) and add to `AirlockApi`:

```ts
  secretsList(): Promise<SecretMeta[]>;
  secretsSet(name: string, value: string): Promise<SecretMeta>;
  secretsDelete(name: string): Promise<void>;
  secretsImportEnv(relPath: string, deleteAfter: boolean): Promise<ImportResult>;
  configGet(): Promise<ProjectConfig>;
  configSet(patch: Partial<ProjectConfig>): Promise<ProjectConfig>;
  auditRead(limit: number): Promise<AuditEntry[]>;
```

- [ ] **Step 6: Extend `main/ipc.ts`** — add imports from `@airlock/agent-core`: `deleteSecret, importDotEnv, injectInto, listSecrets, readAudit, readProjectConfig, setSecret, writeProjectConfig`. Add handlers inside `registerIpc()`:

```ts
  ipcMain.handle("secrets:list", () => listSecrets(requireRoot()));

  ipcMain.handle("secrets:set", (_e, name: string, value: string) => {
    if (typeof name !== "string" || typeof value !== "string") {
      throw new Error("Invalid payload");
    }
    return setSecret(requireRoot(), name, value);
  });

  ipcMain.handle("secrets:delete", (_e, name: string) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    return deleteSecret(requireRoot(), name);
  });

  ipcMain.handle("secrets:importEnv", (_e, relPath: string, deleteAfter: boolean) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    return importDotEnv(requireRoot(), relPath, { deleteAfter: deleteAfter === true });
  });

  ipcMain.handle("config:get", () => readProjectConfig(requireRoot()));

  ipcMain.handle("config:set", (_e, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid payload");
    const p = patch as { injectSecretsIntoTerminal?: unknown };
    const clean =
      typeof p.injectSecretsIntoTerminal === "boolean"
        ? { injectSecretsIntoTerminal: p.injectSecretsIntoTerminal }
        : {};
    return writeProjectConfig(requireRoot(), clean);
  });

  ipcMain.handle("audit:read", (_e, limit: number) =>
    readAudit(requireRoot(), Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50),
  );
```

And make `pty:create` inject when the toggle is on (replace the existing handler body's first lines):

```ts
  ipcMain.handle("pty:create", async (e, cols: number, rows: number) => {
    let secretEnv: Record<string, string> | undefined;
    if (workspaceRoot) {
      const cfg = await readProjectConfig(workspaceRoot);
      if (cfg.injectSecretsIntoTerminal) {
        const r = await injectInto(workspaceRoot, {});
        secretEnv = r.env;
      }
    }
    const s = createPtySession({
      cwd: workspaceRoot ?? undefined,
      cols,
      rows,
      env: secretEnv,
    });
    // ... rest of the existing handler unchanged (sessions.set, onData, onExit, return s.id)
```

- [ ] **Step 7: Extend `preload/index.ts`** — add to the `api` object:

```ts
  secretsList: () => ipcRenderer.invoke("secrets:list"),
  secretsSet: (name, value) => ipcRenderer.invoke("secrets:set", name, value),
  secretsDelete: (name) => ipcRenderer.invoke("secrets:delete", name),
  secretsImportEnv: (relPath, deleteAfter) =>
    ipcRenderer.invoke("secrets:importEnv", relPath, deleteAfter),
  configGet: () => ipcRenderer.invoke("config:get"),
  configSet: (patch) => ipcRenderer.invoke("config:set", patch),
  auditRead: (limit) => ipcRenderer.invoke("audit:read", limit),
```

- [ ] **Step 8: Typecheck, full suite, boot**

Run: `npm run typecheck && npm test`
Expected: clean; all tests green (58 total: 56 + 2 config).
Boot (headless protocol): `ELECTRON_ENABLE_LOGGING=1 timeout 20 npm run dev > /tmp/airlock-pA8.log 2>&1; tail -25 /tmp/airlock-pA8.log` → clean (known artifacts only). Kill stragglers.

- [ ] **Step 9: Commit**

```bash
git add packages/agent-core packages/app
git commit -m "feat(app): secrets/config/audit IPC + opt-in terminal secret injection"
```

---

### Task 9: Secrets UI — section + secure modal

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts`
- Create: `packages/app/src/renderer/src/components/SecretsSection.tsx`
- Create: `packages/app/src/renderer/src/components/SecretModal.tsx`
- Modify: `packages/app/src/renderer/src/components/Sidebar.tsx`
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`

- [ ] **Step 1: Extend `store.ts`** — full file after edit:

```ts
import { create } from "zustand";
import type { FileContent, ProjectConfig, SecretMeta } from "../../shared/ipc";

interface AppState {
  root: string | null;
  selectedFile: string | null;
  file: FileContent | null;
  secrets: SecretMeta[];
  config: ProjectConfig | null;
  termNonce: number;
  modal: "add-secret" | { update: string } | null;
  setRoot: (root: string | null) => void;
  setSelected: (relPath: string | null, file: FileContent | null) => void;
  setSecrets: (secrets: SecretMeta[]) => void;
  setConfig: (config: ProjectConfig | null) => void;
  setModal: (modal: AppState["modal"]) => void;
  restartTerminal: () => void;
}

export const useApp = create<AppState>((set) => ({
  root: null,
  selectedFile: null,
  file: null,
  secrets: [],
  config: null,
  termNonce: 0,
  modal: null,
  setRoot: (root) =>
    set({ root, selectedFile: null, file: null, secrets: [], config: null, modal: null }),
  setSelected: (selectedFile, file) => set({ selectedFile, file }),
  setSecrets: (secrets) => set({ secrets }),
  setConfig: (config) => set({ config }),
  setModal: (modal) => set({ modal }),
  restartTerminal: () => set((s) => ({ termNonce: s.termNonce + 1 })),
}));
```

- [ ] **Step 2: Write `components/SecretModal.tsx`**

```tsx
import { useState } from "react";
import { useApp } from "../store";

const COMMON_NAMES = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "SNOWFLAKE_PASSWORD",
  "SNOWFLAKE_PRIVATE_KEY",
  "JWT_SECRET",
  "GITHUB_TOKEN",
];

export function SecretModal() {
  const { modal, setModal, setSecrets, restartTerminal, config } = useApp();
  const updating = modal !== null && modal !== "add-secret" ? modal.update : null;
  const [name, setName] = useState(updating ?? "");
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (modal === null) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const meta = await window.airlock.secretsSet(name.trim(), value);
      if (!meta.valid) {
        // Stored, but the format check disagrees - surface it and let the
        // user decide to fix or keep.
        setError("Saved, but the value looks unusual for this name. Check the provider hint.");
      }
      setSecrets(await window.airlock.secretsList());
      setModal(null);
      if (config?.injectSecretsIntoTerminal) restartTerminal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">{updating ? `Update ${updating}` : "Add secret"}</div>
        {!updating && (
          <>
            <input
              className="modal-input"
              placeholder="NAME (e.g. DATABASE_URL)"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              list="common-secret-names"
              spellCheck={false}
            />
            <datalist id="common-secret-names">
              {COMMON_NAMES.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </>
        )}
        <textarea
          className={`modal-input modal-value${show ? "" : " masked"}`}
          placeholder="Secret value (paste here)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          spellCheck={false}
        />
        <label className="modal-show">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          show value
        </label>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-caption">This value never reaches the AI model.</div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setModal(null)} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={busy || name.trim() === "" || value === ""}
          >
            {busy ? "Saving…" : "Save to Keychain"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `components/SecretsSection.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../store";

export function SecretsSection() {
  const { root, secrets, setSecrets, config, setConfig, setModal, restartTerminal } = useApp();
  const [needsRestart, setNeedsRestart] = useState(false);

  const refresh = useCallback(async () => {
    setSecrets(await window.airlock.secretsList());
    setConfig(await window.airlock.configGet());
  }, [setSecrets, setConfig]);

  useEffect(() => {
    if (root) refresh().catch(console.error);
  }, [root, refresh]);

  if (!root) return <div className="section-note">open a folder first</div>;

  const toggleInject = async () => {
    const next = await window.airlock.configSet({
      injectSecretsIntoTerminal: !(config?.injectSecretsIntoTerminal ?? false),
    });
    setConfig(next);
    setNeedsRestart(true);
  };

  const removeSecret = async (name: string) => {
    await window.airlock.secretsDelete(name);
    await refresh();
    if (config?.injectSecretsIntoTerminal) setNeedsRestart(true);
  };

  const importEnv = async () => {
    try {
      const r = await window.airlock.secretsImportEnv(".env", true);
      await refresh();
      setNeedsRestart(true);
      alert(
        `Imported ${r.imported.length} secret(s) to the Keychain.` +
          `${r.deleted ? " .env deleted." : ""}` +
          `${r.skipped.length ? ` Skipped: ${r.skipped.join(", ")}` : ""}`,
      );
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const restart = () => {
    restartTerminal();
    setNeedsRestart(false);
  };

  return (
    <div className="secrets">
      {secrets.map((s) => (
        <div key={s.name} className="secret-row">
          <button
            type="button"
            className="secret-name"
            title="Update value"
            onClick={() => setModal({ update: s.name })}
          >
            {s.name}
          </button>
          {s.provider && <span className="badge dim-badge">{s.provider}</span>}
          {!s.valid && <span className="badge">check</span>}
          <button
            type="button"
            className="secret-delete"
            title="Delete from Keychain"
            onClick={() => removeSecret(s.name)}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="secret-actions">
        <button type="button" className="btn" onClick={() => setModal("add-secret")}>
          + Add
        </button>
        <button type="button" className="btn" onClick={importEnv} title="Vault .env, then delete it">
          Import .env
        </button>
      </div>
      <label className="inject-toggle" title="New terminal sessions get these as env vars">
        <input
          type="checkbox"
          checked={config?.injectSecretsIntoTerminal ?? false}
          onChange={toggleInject}
        />
        inject into terminal
      </label>
      {needsRestart && (
        <button type="button" className="restart-hint" onClick={restart}>
          ↻ restart terminal to apply
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `Sidebar.tsx`** — import `SecretsSection`, replace the Secrets placeholder:

```tsx
      <Section title="Secrets">
        <SecretsSection />
      </Section>
```

(Section loses its `dim` for Secrets. Git/Agent Log placeholders stay for now — Audit replaces Agent Log in Task 10.)

- [ ] **Step 5: Mount the modal + nonce-keyed terminal in `App.tsx`** — full file after edit:

```tsx
import { Sidebar } from "./components/Sidebar";
import { SecretModal } from "./components/SecretModal";
import { TerminalPane } from "./components/TerminalPane";
import { Viewer } from "./components/Viewer";
import { useApp } from "./store";

export function App() {
  const root = useApp((s) => s.root);
  const selectedFile = useApp((s) => s.selectedFile);
  const termNonce = useApp((s) => s.termNonce);
  return (
    <div className="layout">
      <Sidebar />
      <div className={`main${selectedFile ? " split" : ""}`}>
        <div className="viewer-pane">
          <Viewer />
        </div>
        <div className="terminal-slot">
          <TerminalPane key={`${root ?? "no-workspace"}:${termNonce}`} />
        </div>
      </div>
      <SecretModal />
    </div>
  );
}
```

- [ ] **Step 6: Append styles to `theme.css`**

```css
.secrets {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.secret-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.secret-name {
  background: none;
  border: none;
  color: var(--fg);
  font-size: 12px;
  font-family: "SF Mono", Menlo, monospace;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.secret-name:hover {
  background: #1a2129;
}

.secret-delete {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--fg-dim);
  cursor: pointer;
  font-size: 11px;
}

.secret-delete:hover {
  color: #f85149;
}

.secret-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.btn {
  background: #1a2129;
  border: 1px solid var(--border);
  color: var(--fg);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn:hover {
  background: #222b36;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #06121f;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.inject-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg-dim);
  margin-top: 6px;
  cursor: pointer;
}

.restart-hint {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  padding: 2px 0;
  font-family: inherit;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  z-index: 10;
}

.modal {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  width: 420px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-title {
  font-size: 13px;
  font-weight: 600;
}

.modal-input {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  font-size: 13px;
  padding: 6px 8px;
  font-family: "SF Mono", Menlo, monospace;
}

.modal-value.masked {
  -webkit-text-security: disc;
}

.modal-show {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--fg-dim);
}

.modal-error {
  color: #f85149;
  font-size: 12px;
}

.modal-caption {
  font-size: 11px;
  color: var(--fg-dim);
  font-style: italic;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
```

- [ ] **Step 7: Typecheck, suite, lint, boot**

Run: `npm run typecheck && npm test && npx biome check --write packages/app && npx biome check packages/app`
Expected: all clean (biome mechanical fixes fine).
Boot headless 20s with logging → clean. (The modal/section cannot be clicked headlessly — the human gate covers interaction.)

- [ ] **Step 8: Commit**

```bash
git add packages/app
git commit -m "feat(app): Secrets section + secure modal — keychain CRUD, inject toggle, .env import"
```

---

### Task 10: Audit section + README + gate

**Files:**
- Create: `packages/app/src/renderer/src/components/AuditSection.tsx`
- Modify: `packages/app/src/renderer/src/components/Sidebar.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`
- Modify: `README.md`

- [ ] **Step 1: Write `components/AuditSection.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { AuditEntry } from "../../../shared/ipc";
import { useApp } from "../store";

function shortTime(iso: string): string {
  return iso.slice(11, 19);
}

export function AuditSection() {
  const root = useApp((s) => s.root);
  const secrets = useApp((s) => s.secrets);
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!root) {
      setEntries([]);
      return;
    }
    // Refreshes whenever the secrets list changes (every broker op goes
    // through the store refresh) and on mount.
    window.airlock
      .auditRead(20)
      .then((e) => setEntries(e.reverse()))
      .catch(console.error);
  }, [root, secrets]);

  if (!root) return <div className="section-note">open a folder first</div>;
  if (entries.length === 0) return <div className="section-note">no operations yet</div>;

  return (
    <div className="audit">
      {entries.map((e) => (
        <div key={e.hash} className="audit-row" title={JSON.stringify(e.detail)}>
          <span className="audit-time">{shortTime(e.ts)}</span>
          <span className="audit-op">{e.op}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Replace the Agent Log placeholder in `Sidebar.tsx`** — import `AuditSection`; the section becomes:

```tsx
      <Section title="Audit">
        <AuditSection />
      </Section>
```

(Git placeholder remains — that is Phase B.)

- [ ] **Step 3: Append styles to `theme.css`**

```css
.audit {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.audit-row {
  display: flex;
  gap: 8px;
  font-size: 11px;
  font-family: "SF Mono", Menlo, monospace;
}

.audit-time {
  color: var(--fg-dim);
}

.audit-op {
  color: var(--fg);
}
```

- [ ] **Step 4: Update `README.md`** — replace the Status line with:

```markdown
**Status:** skeleton + Phase A (secrets). Terminal, file tree, viewer split,
keychain-backed secrets with terminal injection, import-from-.env, and a
hash-chained audit log all work. Git sidebar (Phase B) and the agent are next.
```

And add after the Package section:

```markdown
## Secrets

Secrets live in the macOS Keychain (service `airlock`), scoped per project.
Add them in the sidebar, or `Import .env` to vault an existing file (it is
deleted after import by default). Toggle "inject into terminal" and new
terminal sessions receive them as env vars — no `.env` on disk, ever.
Every broker operation lands in `.airlock/audit/log.jsonl`, hash-chained.

Note: the packaged app is ad-hoc signed; after re-packaging, macOS may
re-prompt Keychain access once per rebuild ("airlock wants to access...").
Click Always Allow. A real signing identity would make this stick.
```

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all tests green, typecheck clean, lint zero findings.
Boot headless 20s → clean. Repackage so the gate uses the real app: `npm run package` → release/mac-arm64/airlock.app updated.

- [ ] **Step 6: Commit (no tag — gate first)**

```bash
git add -A
git commit -m "feat(app): audit sidebar section + Phase A docs"
```

- [ ] **Step 7: HUMAN GATE (owner runs this, not the agent)**

In the packaged app, on a real project:
- [ ] Add a secret via the modal — Keychain Access.app shows an `airlock` entry; `.airlock/secrets.json` has the name but NOT the value
- [ ] Toggle "inject into terminal" → restart hint → click it → `printenv NAME` in the terminal prints the value
- [ ] Confirm there is no `.env` anywhere; run the project's dev server — it finds its env vars
- [ ] `Import .env` on a project that has one — vars vaulted, file gone, terminal works after restart
- [ ] Audit section lists every operation; spot-check `.airlock/audit/log.jsonl`
- [ ] Delete a secret — gone from Keychain Access and the list
- [ ] Verdict → tag `secrets-v0.2` + merge happens after approval

---

## Self-review (run after writing, fixes applied inline)

1. **Scope coverage:** broker CRUD + inject (approved items 1-4) → Tasks 6-8; modal + section (item 3) → Task 9; import (item 5) → Tasks 4/7/9; audit v0 (item 6) → Tasks 5/10; deferred items absent by design.
2. **Placeholder scan:** every step has complete code; the one intentional ellipsis ("rest of the existing handler unchanged") points at code that already exists in the repo, with its location named.
3. **Type consistency:** `SecretMeta` originates in meta.ts, re-exported through index.ts and shared/ipc.ts; `BrokerOptions.keychain` optional with `systemKeychain` default everywhere; store `modal` union matches SecretModal's narrowing; `InjectResult.missing` covered in both broker.ts and its test; AirlockApi additions match preload implementations one-to-one.
4. **Boundary check:** renderer imports only shared/ipc types; validators run main-side (validation feedback returns via the set call, not live per-keystroke — deliberate, keeps values out of extra IPC round-trips).
5. **ASCII rule:** all agent-core code/comments in this plan are ASCII-only (multibyte appears only in renderer JSX strings and this doc).
