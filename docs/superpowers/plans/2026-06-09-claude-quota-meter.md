# Claude Quota Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sidebar-pinned meter showing the user's Claude subscription usage limit (0→max per rolling window) and reset countdown, sourced from Claude Code's statusLine `rate_limits` payload.

**Architecture:** A bundled first-party emitter is registered as Claude Code's statusLine (chaining any existing one). On each turn it atomically writes the raw statusLine JSON to a side-channel file. A main-process chokidar watcher parses it and broadcasts `quota:changed` to all windows; the renderer renders a `QuotaMeter` card pinned bottom-left of the sidebar, with a client-side reset countdown. Account-wide data ⇒ one global meter. Opt-in (default off), reversible, never hijacks an existing statusLine.

**Tech Stack:** Electron (main + preload + renderer), TypeScript, React 19, Zustand, chokidar, Vitest, Biome. Spec: `docs/superpowers/specs/2026-06-09-claude-quota-meter-design.md`.

**Conventions to follow (verified in-repo):**
- Test **pure** modules only; leave electron/chokidar wiring thin and untested (mirrors `fsWatch.ts`/`fsWatch.test.ts`).
- `AppPrefs` is defined in `packages/app/src/shared/ipc.ts` (single source of truth) and sanitized per-key in `packages/app/src/main/prefs.ts`.
- Atomic writes = write `<file>.<unique>.tmp` then `rename` (see `prefs.ts`).
- `.tsx` render tests need a `// @vitest-environment jsdom` directive (global env is `node`).
- Commit messages: lowercase `type(scope): summary` (e.g. `feat(quota): ...`).
- Run a single test file with `npx vitest run <path>` from the repo root.

---

## File Structure

**Create:**
- `packages/app/resources/statusline-emit.cjs` — first-party statusLine emitter (siphon + chain).
- `packages/app/src/main/quota/parse.ts` — pure: raw statusLine JSON → `QuotaStatus`.
- `packages/app/src/main/quota/parse.test.ts`
- `packages/app/src/main/quota/install.ts` — pure (node:fs): install/uninstall the chained statusLine + bookkeeping.
- `packages/app/src/main/quota/install.test.ts`
- `packages/app/src/main/quota/emit.test.ts` — spawn test for the emitter `.cjs`.
- `packages/app/src/main/quota/watch.ts` — chokidar watcher + broadcast (thin, untested).
- `packages/app/src/main/quota/wire.ts` — path resolution + reconcile (thin, untested).
- `packages/app/src/renderer/src/lib/quotaFormat.ts` — pure: countdown + clamp.
- `packages/app/src/renderer/src/lib/quotaFormat.test.ts`
- `packages/app/src/renderer/src/lib/useQuota.ts` — hook: seed + subscribe.
- `packages/app/src/renderer/src/components/QuotaMeter.tsx`
- `packages/app/src/renderer/src/components/QuotaMeter.test.tsx`

**Modify:**
- `packages/app/src/shared/ipc.ts` — `QuotaWindow`/`QuotaStatus` types, `AirlockApi.quotaGet`/`onQuotaChanged`, `AppPrefs.quotaMeter`.
- `packages/app/src/main/prefs.ts` — `quotaMeter` default + sanitizer.
- `packages/app/src/main/prefs.test.ts` — quotaMeter default/sanitize coverage.
- `packages/app/src/preload/index.ts` — `quotaGet`/`onQuotaChanged`.
- `packages/app/src/main/ipc.ts` — `quota:get` handler + `prefs:set` reconcile branch.
- `packages/app/src/main/index.ts` — bootstrap wiring.
- `packages/app/package.json` — `extraResources` entry for the emitter.
- `packages/app/src/renderer/src/store.ts` — quota slice.
- `packages/app/src/renderer/src/lib/usePrefs.ts` — hydrate `quotaMeterEnabled`.
- `packages/app/src/renderer/src/App.tsx` — mount `useQuota()`.
- `packages/app/src/renderer/src/components/Sidebar.tsx` — insert `<QuotaMeter/>`.
- `packages/app/src/renderer/src/components/SettingsTab.tsx` — enable toggle.
- `packages/app/src/renderer/src/theme.css` — meter styles.

---

## Task 1: Shared types, IPC contract, and prefs default

**Files:**
- Modify: `packages/app/src/shared/ipc.ts`
- Modify: `packages/app/src/main/prefs.ts`
- Test: `packages/app/src/main/prefs.test.ts`

- [ ] **Step 1: Write the failing prefs test**

Append to `packages/app/src/main/prefs.test.ts` (uses the same `mkdtemp` style as the existing tests in that file — add any missing imports: `import { mkdtemp } from "node:fs/promises"; import { tmpdir } from "node:os"; import path from "node:path";`):

```ts
it("defaults quotaMeter to disabled and sanitizes bad input", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prefs-quota-"));
  const f = path.join(dir, "prefs.json");
  expect((await loadPrefs(f)).quotaMeter).toEqual({ enabled: false });
  await savePrefs(f, { quotaMeter: { enabled: true } });
  expect((await loadPrefs(f)).quotaMeter).toEqual({ enabled: true });
  // Non-boolean enabled -> falls back to the default (disabled).
  await savePrefs(f, { quotaMeter: { enabled: "yes" } as unknown as { enabled: boolean } });
  expect((await loadPrefs(f)).quotaMeter).toEqual({ enabled: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/main/prefs.test.ts`
Expected: FAIL (type error / `quotaMeter` undefined).

- [ ] **Step 3: Add the shared types**

In `packages/app/src/shared/ipc.ts`, add these interfaces near the other UI-state interfaces (e.g. just above `AppPrefs`):

```ts
/** One Claude subscription usage window (5-hour or 7-day). */
export interface QuotaWindow {
  usedPercentage: number; // 0-100
  resetsAt: number; // Unix epoch seconds
}

/**
 * Account-wide Claude subscription usage, parsed from Claude Code's statusLine
 * `rate_limits` payload. `available` is false until the first emit carries
 * rate limits (before the first response, or for non-Pro/Max users). Either
 * window may be null independently. NO token counts cross -- only percentages,
 * a reset timestamp, and a model label.
 */
export interface QuotaStatus {
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  model: string | null;
  updatedAt: number; // epoch seconds when the emit was read
  available: boolean;
}
```

In the `AppPrefs` interface, add this field (after `agentPolicy`):

```ts
  // Claude subscription usage meter. Opt-in (default false): enabling installs
  // a chained Claude Code statusLine that AirLock reads. App-global.
  quotaMeter: { enabled: boolean };
```

In the `AirlockApi` interface, add (after the `prefsSet` line):

```ts
  // Claude quota meter: last-known account usage (null before the first emit),
  // pushed live on quota:changed.
  quotaGet(): Promise<QuotaStatus | null>;
  onQuotaChanged(cb: (s: QuotaStatus) => void): () => void;
```

And add `QuotaStatus` to the type import/export blocks at the top is NOT needed — `QuotaWindow`/`QuotaStatus` are declared in this file directly.

- [ ] **Step 4: Add the prefs default + sanitizer**

In `packages/app/src/main/prefs.ts`, add the sanitizer (near `sanitizeMcp`):

```ts
// quotaMeter is app-global and opt-in. Only a real boolean `enabled` overrides
// the default-off; anything else (absent, partial, wrong type) -> disabled.
function sanitizeQuotaMeter(raw: unknown): { enabled: boolean } {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.enabled === "boolean") return { enabled: r.enabled };
  }
  return { enabled: false };
}
```

Add to `DEFAULTS` (after `agentPolicy`):

```ts
  quotaMeter: { enabled: false },
```

Add to the `out` object inside `sanitize()` (after `agentPolicy: sanitizeAgentPolicy(r.agentPolicy),`):

```ts
    quotaMeter: sanitizeQuotaMeter(r.quotaMeter),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/app/src/main/prefs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/prefs.ts packages/app/src/main/prefs.test.ts
git commit -m "feat(quota): shared QuotaStatus types + opt-in quotaMeter pref"
```

---

## Task 2: Quota parse module (pure)

**Files:**
- Create: `packages/app/src/main/quota/parse.ts`
- Test: `packages/app/src/main/quota/parse.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/app/src/main/quota/parse.test.ts`:

```ts
import { expect, it } from "vitest";
import { parseQuota } from "./parse";

const NOW = 1_700_000_000;

it("parses both windows and clamps/floors values", () => {
  const text = JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: 39.4, resets_at: 1_700_004_321.9 },
      seven_day: { used_percentage: 120, resets_at: 1_700_400_000 },
    },
    model: { id: "claude-opus-4-8", display_name: "Opus 4.8" },
  });
  const s = parseQuota(text, NOW);
  expect(s.available).toBe(true);
  expect(s.fiveHour).toEqual({ usedPercentage: 39.4, resetsAt: 1_700_004_321 });
  expect(s.sevenDay).toEqual({ usedPercentage: 100, resetsAt: 1_700_400_000 }); // clamped
  expect(s.model).toBe("Opus 4.8");
  expect(s.updatedAt).toBe(NOW);
});

it("handles only one window present", () => {
  const text = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 5, resets_at: 10 } } });
  const s = parseQuota(text, NOW);
  expect(s.fiveHour).toEqual({ usedPercentage: 5, resetsAt: 10 });
  expect(s.sevenDay).toBeNull();
  expect(s.available).toBe(true);
});

it("reports unavailable when rate_limits is absent", () => {
  const s = parseQuota(JSON.stringify({ model: "x", cost: { total_cost_usd: 1 } }), NOW);
  expect(s).toEqual({ fiveHour: null, sevenDay: null, model: "x", updatedAt: NOW, available: false });
});

it("reports unavailable for empty or garbage input", () => {
  expect(parseQuota("", NOW).available).toBe(false);
  expect(parseQuota("not json", NOW).available).toBe(false);
  expect(parseQuota("null", NOW).available).toBe(false);
});

it("falls back to model id when no display_name", () => {
  const text = JSON.stringify({ model: { id: "claude-x" }, rate_limits: {} });
  expect(parseQuota(text, NOW).model).toBe("claude-x");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/main/quota/parse.test.ts`
Expected: FAIL ("Cannot find module './parse'").

- [ ] **Step 3: Implement `parse.ts`**

`packages/app/src/main/quota/parse.ts`:

```ts
import type { QuotaStatus, QuotaWindow } from "../../shared/ipc";

function parseWindow(raw: unknown): QuotaWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.used_percentage === "number" &&
    Number.isFinite(r.used_percentage) &&
    typeof r.resets_at === "number" &&
    Number.isFinite(r.resets_at)
  ) {
    return {
      usedPercentage: Math.min(100, Math.max(0, r.used_percentage)),
      resetsAt: Math.floor(r.resets_at),
    };
  }
  return null;
}

function parseModel(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const m = raw as Record<string, unknown>;
    if (typeof m.display_name === "string") return m.display_name;
    if (typeof m.id === "string") return m.id;
  }
  return null;
}

function unavailable(now: number): QuotaStatus {
  return { fiveHour: null, sevenDay: null, model: null, updatedAt: now, available: false };
}

// Parse the raw statusLine JSON the emitter captured into a QuotaStatus. `now`
// is epoch seconds (injected for testability). Defensive: every field optional;
// empty/garbage input or missing rate_limits -> available:false.
export function parseQuota(text: string, now: number): QuotaStatus {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return unavailable(now);
  }
  if (!json || typeof json !== "object") return unavailable(now);
  const r = json as Record<string, unknown>;
  const rl = (r.rate_limits ?? {}) as Record<string, unknown>;
  const fiveHour = parseWindow(rl.five_hour);
  const sevenDay = parseWindow(rl.seven_day);
  return {
    fiveHour,
    sevenDay,
    model: parseModel(r.model),
    updatedAt: now,
    available: fiveHour !== null || sevenDay !== null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app/src/main/quota/parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/quota/parse.ts packages/app/src/main/quota/parse.test.ts
git commit -m "feat(quota): pure parser for statusLine rate_limits payload"
```

---

## Task 3: Statusline installer (pure, node:fs)

**Files:**
- Create: `packages/app/src/main/quota/install.ts`
- Test: `packages/app/src/main/quota/install.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/app/src/main/quota/install.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import {
  buildStatusLineCommand,
  installQuotaStatusLine,
  type QuotaPaths,
  uninstallQuotaStatusLine,
} from "./install";

let paths: QuotaPaths;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "quota-install-"));
  paths = {
    settingsPath: path.join(dir, "settings.json"),
    bookkeepingPath: path.join(dir, "install.json"),
    emitConfigPath: path.join(dir, "emit-config.json"),
    outPath: path.join(dir, "rate-limits.json"),
    execPath: "/fake/Electron",
    emitScript: "/fake/Resources/statusline-emit.cjs",
  };
});

const readJson = async (f: string) => JSON.parse(await readFile(f, "utf8"));

it("builds a command that runs Electron-as-node against the emitter", () => {
  const cmd = buildStatusLineCommand(paths);
  expect(cmd).toContain("ELECTRON_RUN_AS_NODE=1");
  expect(cmd).toContain('"/fake/Electron"');
  expect(cmd).toContain("statusline-emit.cjs");
  expect(cmd).toContain(paths.emitConfigPath);
});

it("installs into an empty settings dir with prior null", async () => {
  await installQuotaStatusLine(paths);
  const settings = await readJson(paths.settingsPath);
  expect(settings.statusLine.command).toContain("statusline-emit.cjs");
  expect(await readJson(paths.emitConfigPath)).toEqual({ out: paths.outPath, prior: null });
  expect((await readJson(paths.bookkeepingPath)).installed).toBe(true);
});

it("captures and chains a pre-existing user statusLine", async () => {
  const prior = { type: "command", command: "my-statusline.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: prior }));
  await installQuotaStatusLine(paths);
  expect((await readJson(paths.emitConfigPath)).prior).toEqual(prior);
  expect((await readJson(paths.settingsPath)).statusLine.command).toContain("statusline-emit.cjs");
});

it("is idempotent: re-install never loses the original prior", async () => {
  const prior = { type: "command", command: "my-statusline.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: prior }));
  await installQuotaStatusLine(paths);
  await installQuotaStatusLine(paths); // re-run; statusLine is now ours
  expect((await readJson(paths.bookkeepingPath)).prior).toEqual(prior);
  expect((await readJson(paths.emitConfigPath)).prior).toEqual(prior);
});

it("uninstall restores the prior statusLine and clears bookkeeping", async () => {
  const prior = { type: "command", command: "my-statusline.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: prior }));
  await installQuotaStatusLine(paths);
  await uninstallQuotaStatusLine(paths);
  expect((await readJson(paths.settingsPath)).statusLine).toEqual(prior);
  expect((await readJson(paths.bookkeepingPath)).installed).toBe(false);
});

it("uninstall removes statusLine entirely when there was no prior", async () => {
  await installQuotaStatusLine(paths);
  await uninstallQuotaStatusLine(paths);
  expect((await readJson(paths.settingsPath)).statusLine).toBeUndefined();
});

it("uninstall leaves a statusLine the user changed after install untouched", async () => {
  await installQuotaStatusLine(paths);
  const userSet = { type: "command", command: "user-changed.sh" };
  await writeFile(paths.settingsPath, JSON.stringify({ statusLine: userSet }));
  await uninstallQuotaStatusLine(paths);
  expect((await readJson(paths.settingsPath)).statusLine).toEqual(userSet);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/main/quota/install.test.ts`
Expected: FAIL ("Cannot find module './install'").

- [ ] **Step 3: Implement `install.ts`**

`packages/app/src/main/quota/install.ts`:

```ts
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Every path the installer needs. Supplied by wire.ts (electron-aware) so this
// module stays electron-free and unit-testable, mirroring prefs.ts.
export interface QuotaPaths {
  settingsPath: string; // ~/.claude/settings.json
  bookkeepingPath: string; // <userData>/quota/install.json (main-only state)
  emitConfigPath: string; // <userData>/quota/emit-config.json (read by the emitter)
  outPath: string; // <userData>/quota/rate-limits.json (side-channel)
  execPath: string; // process.execPath (the app's Electron binary)
  emitScript: string; // absolute path to statusline-emit.cjs
}

// A statusLine command is OURS iff it references the emitter script.
const EMIT_MARKER = "statusline-emit.cjs";

type StatusLine = { type?: string; command?: string } | undefined;
interface Bookkeeping {
  installed: boolean;
  prior: StatusLine;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

function isOurs(sl: StatusLine): boolean {
  return !!sl && typeof sl.command === "string" && sl.command.includes(EMIT_MARKER);
}

// ELECTRON_RUN_AS_NODE makes the app's own Electron binary behave as plain
// node, so no `node`/`jq` on PATH is assumed (packaged-app safe). Paths are
// double-quoted for the POSIX shell Claude Code runs the command in.
export function buildStatusLineCommand(p: QuotaPaths): string {
  return `ELECTRON_RUN_AS_NODE=1 "${p.execPath}" "${p.emitScript}" "${p.emitConfigPath}"`;
}

export async function installQuotaStatusLine(p: QuotaPaths): Promise<void> {
  const settings = (await readJson(p.settingsPath)) ?? {};
  const current = settings.statusLine as StatusLine;
  const book = (await readJson(p.bookkeepingPath)) as unknown as Bookkeeping | null;
  // Capture the user's prior statusLine ONCE. On re-install reuse the saved
  // prior so we never lose it or chain to our own command.
  const prior: StatusLine = book?.installed ? book.prior : isOurs(current) ? book?.prior : current;
  settings.statusLine = { type: "command", command: buildStatusLineCommand(p) };
  await writeJsonAtomic(p.settingsPath, settings);
  await writeJsonAtomic(p.emitConfigPath, { out: p.outPath, prior: prior ?? null });
  await writeJsonAtomic(p.bookkeepingPath, { installed: true, prior: prior ?? null } satisfies Bookkeeping);
}

export async function uninstallQuotaStatusLine(p: QuotaPaths): Promise<void> {
  const book = (await readJson(p.bookkeepingPath)) as unknown as Bookkeeping | null;
  const settings = (await readJson(p.settingsPath)) ?? {};
  const current = settings.statusLine as StatusLine;
  // Only touch statusLine if it is still ours -- never clobber a value the user
  // set after we installed.
  if (isOurs(current)) {
    const prior = book?.prior;
    if (prior) settings.statusLine = prior;
    else delete settings.statusLine;
    await writeJsonAtomic(p.settingsPath, settings);
  }
  await writeJsonAtomic(p.bookkeepingPath, { installed: false, prior: undefined } satisfies Bookkeeping);
  await rm(p.emitConfigPath, { force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app/src/main/quota/install.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/quota/install.ts packages/app/src/main/quota/install.test.ts
git commit -m "feat(quota): chained, reversible statusLine installer"
```

---

## Task 4: Emitter script + packaging

**Files:**
- Create: `packages/app/resources/statusline-emit.cjs`
- Create: `packages/app/src/main/quota/emit.test.ts`
- Modify: `packages/app/package.json`

- [ ] **Step 1: Write the failing spawn test**

`packages/app/src/main/quota/emit.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const EMIT = fileURLToPath(new URL("../../../resources/statusline-emit.cjs", import.meta.url));
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "quota-emit-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(input: string, cfg: object) {
  const cfgPath = path.join(dir, "cfg.json");
  writeFileSync(cfgPath, JSON.stringify(cfg));
  return spawnSync(process.execPath, [EMIT, cfgPath], { input, encoding: "utf8" });
}

it("siphons stdin verbatim to the out file", () => {
  const out = path.join(dir, "rate-limits.json");
  const payload = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12, resets_at: 1 } } });
  const r = run(payload, { out, prior: null });
  expect(r.status).toBe(0);
  expect(readFileSync(out, "utf8")).toBe(payload);
});

it("chains a prior command and passes its stdout through", () => {
  const out = path.join(dir, "rate-limits.json");
  const r = run("hello-footer", { out, prior: { type: "command", command: "cat" } });
  expect(r.stdout).toContain("hello-footer");
  expect(readFileSync(out, "utf8")).toBe("hello-footer");
});

it("does not crash when the config file is missing", () => {
  const r = spawnSync(process.execPath, [EMIT, path.join(dir, "nope.json")], {
    input: "{}",
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/main/quota/emit.test.ts`
Expected: FAIL (emitter file does not exist; spawn errors).

- [ ] **Step 3: Implement the emitter**

`packages/app/resources/statusline-emit.cjs`:

```js
#!/usr/bin/env node
"use strict";
// AirLock Claude quota statusLine emitter. Claude Code pipes the statusLine
// JSON to this command on stdin and uses its stdout as the footer text.
//
// We (1) siphon: atomically write the raw payload to a side-channel file that
// AirLock's main process watches + parses, and (2) chain: re-feed the SAME
// stdin to any pre-existing user statusLine and pass its stdout through, so the
// user's footer is untouched. Config (out path + prior command) is a JSON file
// whose path is argv[2]. Pure CJS, zero deps -- runs under the app's own
// Electron-as-node in production and `node` in dev (no PATH assumptions).
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8"); // fd 0; Claude Code always pipes here
  } catch {
    return "";
  }
}

function main() {
  const input = readStdin();
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  } catch {
    // No/invalid config -> nothing to siphon to and no prior to chain.
  }

  if (cfg && typeof cfg.out === "string") {
    try {
      const tmp = `${cfg.out}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, input);
      fs.renameSync(tmp, cfg.out);
    } catch {
      // Best-effort: a write failure must never break Claude Code's footer.
    }
  }

  const prior = cfg && cfg.prior;
  if (prior && prior.type === "command" && typeof prior.command === "string") {
    const r = spawnSync(prior.command, { input, shell: true, encoding: "utf8" });
    if (r && r.stdout) process.stdout.write(r.stdout);
  }
}

main();
```

- [ ] **Step 4: Register the emitter as a packaged resource**

In `packages/app/package.json`, add to the `build.extraResources` array (after the existing `ts-lib` entry):

```json
      {
        "from": "resources/statusline-emit.cjs",
        "to": "statusline-emit.cjs"
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/app/src/main/quota/emit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/app/resources/statusline-emit.cjs packages/app/src/main/quota/emit.test.ts packages/app/package.json
git commit -m "feat(quota): first-party statusLine emitter (siphon + chain) + packaging"
```

---

## Task 5: Watcher + IPC + preload (wiring)

**Files:**
- Create: `packages/app/src/main/quota/watch.ts`
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`

No dedicated test (electron/chokidar wiring; consistent with `fsWatch.ts`). The logic it depends on — `parseQuota` — is covered by Task 2.

- [ ] **Step 1: Implement `watch.ts`**

`packages/app/src/main/quota/watch.ts`:

```ts
import { type FSWatcher, watch } from "chokidar";
import { BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import type { QuotaStatus } from "../../shared/ipc";
import { parseQuota } from "./parse";

let watcher: FSWatcher | null = null;
let watchedPath: string | null = null;
let latest: QuotaStatus | null = null;

// Last-known status for a newly-opened window to fetch synchronously (quota:get).
export function getQuota(): QuotaStatus | null {
  return latest;
}

function broadcast(s: QuotaStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send("quota:changed", s);
  }
}

async function readAndBroadcast(outPath: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(outPath, "utf8");
  } catch {
    return; // file vanished between event and read; ignore
  }
  latest = parseQuota(text, Math.floor(Date.now() / 1000));
  broadcast(latest);
}

// Watch the side-channel file. Idempotent: re-pointing to the same path is a
// no-op; a different path closes the old watcher. Safe before the file exists
// (chokidar fires `add` when the emitter first writes it).
export function startQuotaWatch(outPath: string): void {
  if (watchedPath === outPath && watcher) return;
  void stopQuotaWatch();
  watchedPath = outPath;
  watcher = watch(outPath, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
  });
  const fire = () => void readAndBroadcast(outPath);
  watcher.on("add", fire).on("change", fire);
}

export async function stopQuotaWatch(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  watchedPath = null;
  latest = null;
}
```

- [ ] **Step 2: Register the `quota:get` handler**

In `packages/app/src/main/ipc.ts`, add an import near the other local imports:

```ts
import { getQuota } from "./quota/watch";
```

Inside `registerIpc(...)`, next to the `prefs:get` handler, add:

```ts
  ipcMain.handle("quota:get", () => getQuota());
```

- [ ] **Step 3: Expose the bridge methods in preload**

In `packages/app/src/preload/index.ts`, add `QuotaStatus` to the type import from `../shared/ipc`, then add to the `api` object (after the `prefsSet` line):

```ts
  quotaGet: () => ipcRenderer.invoke("quota:get"),
  onQuotaChanged: (cb) => subscribe<QuotaStatus>("quota:changed", cb),
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/quota/watch.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts
git commit -m "feat(quota): side-channel watcher + quota IPC bridge"
```

---

## Task 6: Bootstrap wiring + reconcile on toggle

**Files:**
- Create: `packages/app/src/main/quota/wire.ts`
- Modify: `packages/app/src/main/index.ts`
- Modify: `packages/app/src/main/ipc.ts`

No dedicated test (electron-aware glue). Behavior is verified manually in Task 11.

- [ ] **Step 1: Implement `wire.ts`**

`packages/app/src/main/quota/wire.ts`:

```ts
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { installQuotaStatusLine, type QuotaPaths, uninstallQuotaStatusLine } from "./install";
import { startQuotaWatch } from "./watch";

// Resolve every path + the emitter location. Centralized so startup and the
// prefs:set reconcile share identical wiring. The emitter ships via
// extraResources (process.resourcesPath) in production; in dev it sits in the
// repo, resolved relative to the built main dir (out/main -> ../../resources).
export function quotaPaths(): QuotaPaths {
  const quotaDir = path.join(app.getPath("userData"), "quota");
  const emitScript = app.isPackaged
    ? path.join(process.resourcesPath, "statusline-emit.cjs")
    : path.join(__dirname, "../../resources/statusline-emit.cjs");
  return {
    settingsPath: path.join(os.homedir(), ".claude", "settings.json"),
    bookkeepingPath: path.join(quotaDir, "install.json"),
    emitConfigPath: path.join(quotaDir, "emit-config.json"),
    outPath: path.join(quotaDir, "rate-limits.json"),
    execPath: process.execPath,
    emitScript,
  };
}

// Reconcile the on-disk Claude statusLine to match `enabled`, then (re)start the
// watcher. The watcher always runs (idempotent) so a later enable is picked up
// without restart. Best-effort: callers swallow/log so a settings.json write
// failure never crashes the app.
export async function reconcileQuotaMeter(enabled: boolean): Promise<void> {
  const p = quotaPaths();
  if (enabled) await installQuotaStatusLine(p);
  else await uninstallQuotaStatusLine(p);
  startQuotaWatch(p.outPath);
}
```

- [ ] **Step 2: Wire into bootstrap**

In `packages/app/src/main/index.ts`, add the import:

```ts
import { reconcileQuotaMeter } from "./quota/wire";
```

In `bootstrap()`, after the existing `const prefs = await loadPrefs(prefsFile);` line, add:

```ts
    // Quota meter: install/uninstall the chained Claude statusLine to match the
    // saved pref, then start watching the side-channel file. Best-effort -- a
    // failure to touch ~/.claude/settings.json must never break startup.
    await reconcileQuotaMeter(prefs.quotaMeter.enabled).catch((e) =>
      console.warn("[airlock] quota meter wiring failed", e),
    );
```

- [ ] **Step 3: Reconcile when the toggle flips**

In `packages/app/src/main/ipc.ts`, add the import:

```ts
import { reconcileQuotaMeter } from "./quota/wire";
```

In the `prefs:set` handler, after the existing `openProjectsAsTabs` branch and before `return saved;`, add:

```ts
    // Flipping the quota-meter toggle installs/removes the chained Claude
    // statusLine live (best-effort; never throw out of prefs:set).
    if ("quotaMeter" in (patch as object)) {
      const p = await loadPrefs(prefsFile);
      await reconcileQuotaMeter(p.quotaMeter.enabled).catch((e) =>
        console.warn("[airlock] quota meter reconcile failed", e),
      );
    }
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/quota/wire.ts packages/app/src/main/index.ts packages/app/src/main/ipc.ts
git commit -m "feat(quota): install/uninstall on startup and on toggle"
```

---

## Task 7: Format util + store slice

**Files:**
- Create: `packages/app/src/renderer/src/lib/quotaFormat.ts`
- Test: `packages/app/src/renderer/src/lib/quotaFormat.test.ts`
- Modify: `packages/app/src/renderer/src/store.ts`

- [ ] **Step 1: Write the failing format test**

`packages/app/src/renderer/src/lib/quotaFormat.test.ts`:

```ts
import { expect, it } from "vitest";
import { clampPct, formatCountdown } from "./quotaFormat";

it("formats countdowns compactly", () => {
  expect(formatCountdown(0)).toBe("now");
  expect(formatCountdown(-10)).toBe("now");
  expect(formatCountdown(30)).toBe("<1m");
  expect(formatCountdown(90)).toBe("1m");
  expect(formatCountdown(4350)).toBe("1h12m"); // 1h 12m 30s
  expect(formatCountdown(90000)).toBe("1d 1h"); // 25h
});

it("clamps percentages into 0..100", () => {
  expect(clampPct(-5)).toBe(0);
  expect(clampPct(150)).toBe(100);
  expect(clampPct(42)).toBe(42);
  expect(clampPct(Number.NaN)).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/renderer/src/lib/quotaFormat.test.ts`
Expected: FAIL ("Cannot find module './quotaFormat'").

- [ ] **Step 3: Implement `quotaFormat.ts`**

`packages/app/src/renderer/src/lib/quotaFormat.ts`:

```ts
// Format remaining seconds as a compact countdown: "2d 3h", "1h12m", "4m",
// "<1m", or "now" when not positive. Pure + deterministic for tests.
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app/src/renderer/src/lib/quotaFormat.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the store slice**

In `packages/app/src/renderer/src/store.ts`:

1. Add `QuotaStatus` to the existing type import from the shared ipc module (the file already imports shared types; add `QuotaStatus` to that import list).

2. In the `AppState` interface (the type argument to `create<AppState>(...)`), add:

```ts
  quota: QuotaStatus | null;
  setQuota: (q: QuotaStatus) => void;
  quotaMeterEnabled: boolean;
  setQuotaMeterEnabled: (v: boolean) => void;
```

3. In the store object literal `create<AppState>((set) => ({`, add:

```ts
  quota: null,
  setQuota: (q) => set({ quota: q }),
  quotaMeterEnabled: false,
  setQuotaMeterEnabled: (v) => set({ quotaMeterEnabled: v }),
```

- [ ] **Step 6: Verify it compiles + run renderer tests**

Run: `npm run typecheck && npx vitest run packages/app/src/renderer/src/store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/renderer/src/lib/quotaFormat.ts packages/app/src/renderer/src/lib/quotaFormat.test.ts packages/app/src/renderer/src/store.ts
git commit -m "feat(quota): countdown/clamp formatters + store slice"
```

---

## Task 8: useQuota hook, prefs hydration, App mount

**Files:**
- Create: `packages/app/src/renderer/src/lib/useQuota.ts`
- Modify: `packages/app/src/renderer/src/lib/usePrefs.ts`
- Modify: `packages/app/src/renderer/src/App.tsx`

No dedicated test (thin hooks; mirrors `useFsWatch.ts`, which has none). Render behavior is covered in Task 9.

- [ ] **Step 1: Implement `useQuota.ts`**

`packages/app/src/renderer/src/lib/useQuota.ts`:

```ts
import { useEffect } from "react";
import { useApp } from "../store";

// Seed the quota meter from main's last-known status, then live-update on every
// emit. Mirrors useFsWatch: subscribe on mount, unsubscribe on unmount.
export function useQuota(): void {
  const setQuota = useApp((s) => s.setQuota);
  useEffect(() => {
    let cancelled = false;
    window.airlock
      .quotaGet()
      .then((s) => {
        if (!cancelled && s) setQuota(s);
      })
      .catch(console.error);
    const off = window.airlock.onQuotaChanged((s) => setQuota(s));
    return () => {
      cancelled = true;
      off();
    };
  }, [setQuota]);
}
```

- [ ] **Step 2: Hydrate `quotaMeterEnabled` in `usePrefs`**

In `packages/app/src/renderer/src/lib/usePrefs.ts`, add a selector near the others:

```ts
  const setQuotaMeterEnabled = useApp((s) => s.setQuotaMeterEnabled);
```

Inside the guarded `.then((p) => { ... })` block (after `setSectionVisibility(p.sectionVisibility);`), add:

```ts
        setQuotaMeterEnabled(p.quotaMeter.enabled);
```

Add `setQuotaMeterEnabled` to that effect's dependency array.

- [ ] **Step 3: Mount the hook in App**

In `packages/app/src/renderer/src/App.tsx`, add the import:

```ts
import { useQuota } from "./lib/useQuota";
```

And call it alongside the other hooks at the top of `App()`:

```ts
  useQuota();
```

- [ ] **Step 4: Verify it compiles + smoke test still passes**

Run: `npm run typecheck && npx vitest run packages/app/src/renderer/src/App.smoke.test.tsx`
Expected: PASS.

> Note: the smoke test renders `<App/>`, which now calls `window.airlock.quotaGet()`/`onQuotaChanged`. If the test's `window.airlock` stub does not define these, add them: `quotaGet: () => Promise.resolve(null)` and `onQuotaChanged: () => () => {}`. Check `App.smoke.test.tsx` for how `window.airlock` is stubbed and extend it the same way the existing methods are.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/src/lib/useQuota.ts packages/app/src/renderer/src/lib/usePrefs.ts packages/app/src/renderer/src/App.tsx packages/app/src/renderer/src/App.smoke.test.tsx
git commit -m "feat(quota): useQuota hook, prefs hydration, App mount"
```

---

## Task 9: QuotaMeter component + sidebar placement + styles

**Files:**
- Create: `packages/app/src/renderer/src/components/QuotaMeter.tsx`
- Test: `packages/app/src/renderer/src/components/QuotaMeter.test.tsx`
- Modify: `packages/app/src/renderer/src/components/Sidebar.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`

- [ ] **Step 1: Write the failing render test**

`packages/app/src/renderer/src/components/QuotaMeter.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useApp } from "../store";
import { QuotaMeter } from "./QuotaMeter";

afterEach(cleanup);

it("renders nothing when the meter is disabled", () => {
  useApp.setState({ quotaMeterEnabled: false, quota: null });
  const { container } = render(<QuotaMeter />);
  expect(container.firstChild).toBeNull();
});

it("shows the waiting state when enabled with no data yet", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: null });
  render(<QuotaMeter />);
  expect(screen.getByText("Waiting for Claude…")).toBeTruthy();
});

it("shows unavailable when an emit arrived without rate limits", () => {
  useApp.setState({
    quotaMeterEnabled: true,
    quota: { fiveHour: null, sevenDay: null, model: null, updatedAt: 1, available: false },
  });
  render(<QuotaMeter />);
  expect(screen.getByText("Rate limits unavailable")).toBeTruthy();
});

it("renders 5h and 7d rows with percentages when available", () => {
  useApp.setState({
    quotaMeterEnabled: true,
    quota: {
      fiveHour: { usedPercentage: 39, resetsAt: 9_999_999_999 },
      sevenDay: { usedPercentage: 22, resetsAt: 9_999_999_999 },
      model: "Opus 4.8",
      updatedAt: 1,
      available: true,
    },
  });
  render(<QuotaMeter />);
  expect(screen.getByText("5h")).toBeTruthy();
  expect(screen.getByText("7d")).toBeTruthy();
  expect(screen.getByText("39%")).toBeTruthy();
  expect(screen.getByText("22%")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/renderer/src/components/QuotaMeter.test.tsx`
Expected: FAIL ("Cannot find module './QuotaMeter'").

- [ ] **Step 3: Implement `QuotaMeter.tsx`**

`packages/app/src/renderer/src/components/QuotaMeter.tsx`:

```tsx
import { useEffect, useState } from "react";
import { clampPct, formatCountdown } from "../lib/quotaFormat";
import { useApp } from "../store";

function Row({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="quota-row">
      <span className="quota-row-label">{label}</span>
      <span className="quota-bar" aria-hidden>
        <span className="quota-bar-fill" style={{ width: `${clampPct(pct)}%` }} />
      </span>
      <span className="quota-pct">{Math.round(pct)}%</span>
    </div>
  );
}

// Account-wide Claude subscription usage, pinned bottom-left of the sidebar.
// Renders null when disabled so the sidebar layout is unaffected. A 1s ticker
// keeps the reset countdown live between emits (no polling of main).
export function QuotaMeter() {
  const enabled = useApp((s) => s.quotaMeterEnabled);
  const quota = useApp((s) => s.quota);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  if (!quota) {
    return (
      <div className="quota-meter">
        <div className="quota-title">Plan usage</div>
        <div className="quota-waiting">Waiting for Claude…</div>
      </div>
    );
  }

  if (!quota.available) {
    return (
      <div className="quota-meter">
        <div className="quota-title">Plan usage</div>
        <div className="quota-waiting">Rate limits unavailable</div>
      </div>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  return (
    <div className="quota-meter" title={quota.model ?? undefined}>
      <div className="quota-title">Plan usage</div>
      {quota.fiveHour && <Row label="5h" pct={quota.fiveHour.usedPercentage} />}
      {quota.sevenDay && <Row label="7d" pct={quota.sevenDay.usedPercentage} />}
      {quota.fiveHour && (
        <div
          className="quota-reset"
          title={
            quota.sevenDay
              ? `7-day resets in ${formatCountdown(quota.sevenDay.resetsAt - now)}`
              : undefined
          }
        >
          <i className="codicon codicon-history" /> resets {formatCountdown(quota.fiveHour.resetsAt - now)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app/src/renderer/src/components/QuotaMeter.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Insert into the sidebar**

In `packages/app/src/renderer/src/components/Sidebar.tsx`, add the import:

```ts
import { QuotaMeter } from "./QuotaMeter";
```

Place `<QuotaMeter />` between the closing `</div>` of `.sidebar-sections` and `<SidebarFooter />`:

```tsx
      </div>
      <QuotaMeter />
      <SidebarFooter />
    </aside>
```

(`.sidebar-sections` keeps `flex:1; overflow-y:auto`, so the meter — a normal flex child — reserves its height at the bottom and the project sections reflow above it and scroll. When disabled, `QuotaMeter` returns null, so layout is unchanged.)

- [ ] **Step 6: Add styles**

In `packages/app/src/renderer/src/theme.css`, add near the `.sidebar-footer` rules:

```css
.quota-meter {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--fg-dim);
}
.quota-title {
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-dim);
}
.quota-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.quota-row-label {
  width: 18px;
  flex: none;
  color: var(--fg-dim);
}
.quota-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--hover);
  overflow: hidden;
}
.quota-bar-fill {
  display: block;
  height: 100%;
  background: var(--accent, #4aa3ff);
  transition: width 0.3s ease;
}
.quota-pct {
  width: 34px;
  flex: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--fg);
}
.quota-reset {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-dim);
}
.quota-waiting {
  color: var(--fg-dim);
  font-style: italic;
}
```

> If `--accent` is not a defined theme variable, replace `var(--accent, #4aa3ff)` with the project's existing accent variable (grep `theme.css` for the color used by active/running states, e.g. the one on `.status-dot.running`). The fallback `#4aa3ff` keeps it valid regardless.

- [ ] **Step 7: Verify compile + tests**

Run: `npm run typecheck && npx vitest run packages/app/src/renderer/src/components/QuotaMeter.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/renderer/src/components/QuotaMeter.tsx packages/app/src/renderer/src/components/QuotaMeter.test.tsx packages/app/src/renderer/src/components/Sidebar.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(quota): sidebar-pinned QuotaMeter card + styles"
```

---

## Task 10: Settings toggle

**Files:**
- Modify: `packages/app/src/renderer/src/components/SettingsTab.tsx`

- [ ] **Step 1: Add the toggle**

In `packages/app/src/renderer/src/components/SettingsTab.tsx`, add two selectors near the other `useApp` selectors at the top of the component:

```ts
  const quotaMeterEnabled = useApp((s) => s.quotaMeterEnabled);
  const setQuotaMeterEnabled = useApp((s) => s.setQuotaMeterEnabled);
```

Add a new section in the returned JSX, before the `Agent` section:

```tsx
        <section className="settings-section">
          <h3>Claude</h3>
          <div className="settings-row">
            <label htmlFor="quota-meter">Show Claude usage meter</label>
            <input
              id="quota-meter"
              type="checkbox"
              checked={quotaMeterEnabled}
              onChange={(e) => {
                const v = e.target.checked;
                useApp.getState().setLayoutHydrated(true);
                setQuotaMeterEnabled(v);
                void window.airlock.prefsSet({ quotaMeter: { enabled: v } });
              }}
            />
          </div>
          <p className="settings-note">
            Shows your Claude subscription usage (5-hour and 7-day limits) and a
            reset countdown in the sidebar. Enabling installs a Claude Code
            status line that AirLock reads; if you already have a custom status
            line, AirLock chains it so your footer is unchanged. Turning this off
            removes it completely.
          </p>
        </section>
```

- [ ] **Step 2: Verify compile**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/renderer/src/components/SettingsTab.tsx
git commit -m "feat(quota): settings toggle for the Claude usage meter"
```

---

## Task 11: Full verification + manual check

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, including all new files (`parse`, `install`, `emit`, `quotaFormat`, `QuotaMeter`, `prefs`).

- [ ] **Step 2: Typecheck both packages**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (no Biome errors). Fix any formatting with `npx biome check --write .` and re-commit if needed.

- [ ] **Step 4: Manual smoke (real app)**

Run: `npm run dev`

Verify:
1. Default: no meter in the sidebar (opt-in off). Project sections fill the sidebar as before.
2. Settings → Claude → enable "Show Claude usage meter". The card appears bottom-left; project sections shrink above it and still scroll; no overlap.
3. In an AirLock terminal, run `claude` and send one message. After the first response the meter populates (5h / 7d bars + "resets …"). The countdown ticks down each second.
4. Confirm `~/.claude/settings.json` has a `statusLine` whose command contains `statusline-emit.cjs`. If you had a prior `statusLine`, confirm your own footer still renders in Claude Code (chaining works).
5. Disable the toggle → meter disappears and `~/.claude/settings.json` `statusLine` is restored to its prior value (or removed if there was none).

- [ ] **Step 5: Final commit (if any lint/format fixes)**

```bash
git add -A
git commit -m "chore(quota): lint/format pass"
```

---

## Self-Review (completed during planning)

**Spec coverage:** Data source (Tasks 2,4,5) · chained/reversible/opt-in install (Tasks 3,6,10) · account-wide single meter (Task 9) · IPC + types (Tasks 1,5) · sidebar bottom-left no-overlap placement (Task 9) · client-side countdown (Tasks 7,9) · degradation states waiting/unavailable/one-window (Tasks 2,9) · prefs default off (Task 1) · packaging-gated emitter path (Tasks 4,6) · testing of pure modules only (Tasks 2,3,4,7,9) — all mapped. Stale-data dimming from the spec is intentionally deferred (YAGNI for v1; `updatedAt` is carried so it can be added later without a data change) — noted here so it isn't mistaken for a gap.

**Placeholder scan:** No TBD/TODO; every code step contains complete code. The two "if X variable isn't defined, do Y" notes (App smoke stub, `--accent` var) are concrete fallbacks with exact instructions, not placeholders.

**Type consistency:** `QuotaStatus`/`QuotaWindow` field names (`fiveHour`, `sevenDay`, `usedPercentage`, `resetsAt`, `model`, `updatedAt`, `available`) are identical across `ipc.ts`, `parse.ts`, `watch.ts`, store, hook, and component. `QuotaPaths` fields match between `install.ts`, `install.test.ts`, and `wire.ts`. `quotaMeter: { enabled: boolean }` is consistent across `AppPrefs`, `prefs.ts`, `usePrefs.ts`, and the toggle. IPC channel names (`quota:get`, `quota:changed`) match between preload and `ipc.ts`/`watch.ts`.
