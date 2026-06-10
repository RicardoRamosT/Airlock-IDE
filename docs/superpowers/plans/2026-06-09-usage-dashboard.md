# Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking the Plan Usage meter opens a full-page Usage view with account windows plus live per-model and per-session token/cost tables.

**Architecture:** The quota watcher keeps a capped per-session ledger parsed from each statusLine emit (pure `parseSessionUsage` + `recordUsage` in parse.ts); one `usage:get` IPC serves it. The page is a WINDOW-level overlay (account-wide data — lives beside palette/search, no per-tab plumbing) that polls every 2s while open. Aggregation/formatting are pure renderer helpers.

**Tech Stack:** existing quota pipeline, vitest (node) for the pure layers, React overlay + theme.css.

**Spec:** `docs/superpowers/specs/2026-06-09-usage-dashboard-design.md`. Commit per task; never push.

---

### Task 1: `SessionUsage` type + pure parse/ledger helpers

**Files:** Modify `packages/app/src/shared/ipc.ts`, `packages/app/src/main/quota/parse.ts`; Modify (append) `packages/app/src/main/quota/parse.test.ts`.

- [ ] **1.1 Failing tests** — append to `parse.test.ts`:

```ts
describe("parseSessionUsage", () => {
  const PAYLOAD = JSON.stringify({
    session_id: "abc",
    cwd: "/Users/r/Projects/lendlogic",
    model: { id: "claude-fable-5", display_name: "Fable 5" },
    cost: {
      total_cost_usd: 1.25,
      total_duration_ms: 90_000,
      total_api_duration_ms: 30_000,
      total_lines_added: 10,
      total_lines_removed: 3,
    },
    context_window: {
      total_input_tokens: 50_000,
      total_output_tokens: 2_000,
      current_usage: {
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 5_000,
      },
    },
  });

  it("extracts a full snapshot", () => {
    expect(parseSessionUsage(PAYLOAD, 123)).toEqual({
      sessionId: "abc",
      cwd: "/Users/r/Projects/lendlogic",
      model: "Fable 5",
      totalInputTokens: 50_000,
      totalOutputTokens: 2_000,
      cacheReadTokens: 40_000,
      cacheCreateTokens: 5_000,
      costUsd: 1.25,
      apiMs: 30_000,
      linesAdded: 10,
      linesRemoved: 3,
      lastEmitAt: 123,
    });
  });

  it("zeros missing cost/context_window and tolerates garbage", () => {
    const u = parseSessionUsage(JSON.stringify({ session_id: "x" }), 5);
    expect(u).toMatchObject({
      sessionId: "x",
      totalInputTokens: 0,
      costUsd: 0,
      model: null,
      cwd: null,
    });
    expect(parseSessionUsage("not json", 5)).toBeNull();
    expect(parseSessionUsage(JSON.stringify({ no_session: 1 }), 5)).toBeNull();
  });
});

describe("recordUsage", () => {
  const mkU = (id: string, emitAt: number) =>
    parseSessionUsage(JSON.stringify({ session_id: id }), emitAt);
  it("keeps the latest snapshot per session and evicts the oldest at cap", () => {
    const m = new Map<string, SessionUsage>();
    const a1 = mkU("a", 1);
    const a2 = mkU("a", 9);
    if (!a1 || !a2) throw new Error("fixture");
    recordUsage(m, a1, 2);
    recordUsage(m, a2, 2);
    expect(m.get("a")?.lastEmitAt).toBe(9); // latest wins, no dup
    const b = mkU("b", 5);
    const c = mkU("c", 6);
    if (!b || !c) throw new Error("fixture");
    recordUsage(m, b, 2);
    recordUsage(m, c, 2); // cap 2 -> evict oldest emit ("b"? no: a=9,b=5 -> evict b)
    expect([...m.keys()].sort()).toEqual(["a", "c"]);
  });
});
```

Add imports at the top of the file: `parseSessionUsage, recordUsage` from `./parse`, `describe` from vitest, and `import type { SessionUsage } from "../../shared/ipc";`.

- [ ] **1.2 RED** — `npx vitest run packages/app/src/main/quota/parse.test.ts` → missing exports.

- [ ] **1.3 Implement** — `shared/ipc.ts`, near `QuotaStatus`:

```ts
// One Claude session's cumulative usage, parsed from its latest statusLine
// emit (the side-channel the quota meter already taps). Account-wide truth
// lives in QuotaStatus; this is the per-session/per-model breakdown.
export interface SessionUsage {
  sessionId: string;
  cwd: string | null;
  model: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
  apiMs: number;
  linesAdded: number;
  linesRemoved: number;
  lastEmitAt: number; // epoch s of the emit (file mtime)
}
```

and in `AirlockApi`: `usageGet(): Promise<SessionUsage[]>;`

`parse.ts` — import the type (`import type { QuotaStatus, QuotaWindow, SessionUsage } from "../../shared/ipc";`) and append:

```ts
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

// Extract one session's cumulative usage from a raw statusLine payload.
// Defensive like parseQuota: absent cost/context_window become zeros; only a
// missing session_id (or non-JSON) yields null.
export function parseSessionUsage(
  text: string,
  emitAt: number,
): SessionUsage | null {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!r || typeof r !== "object" || typeof r.session_id !== "string")
    return null;
  const cw = (r.context_window ?? {}) as Record<string, unknown>;
  const cu = (cw.current_usage ?? {}) as Record<string, unknown>;
  const cost = (r.cost ?? {}) as Record<string, unknown>;
  return {
    sessionId: r.session_id,
    cwd: typeof r.cwd === "string" ? r.cwd : null,
    model: parseModel(r.model),
    totalInputTokens: num(cw.total_input_tokens),
    totalOutputTokens: num(cw.total_output_tokens),
    cacheReadTokens: num(cu.cache_read_input_tokens),
    cacheCreateTokens: num(cu.cache_creation_input_tokens),
    costUsd: num(cost.total_cost_usd),
    apiMs: num(cost.total_api_duration_ms),
    linesAdded: num(cost.total_lines_added),
    linesRemoved: num(cost.total_lines_removed),
    lastEmitAt: emitAt,
  };
}

// Fold one snapshot into the ledger: latest emit per session wins; past the
// cap the OLDEST-emitting session is evicted (history, not liveness, decides).
export function recordUsage(
  ledger: Map<string, SessionUsage>,
  u: SessionUsage,
  cap = 50,
): void {
  ledger.set(u.sessionId, u);
  if (ledger.size <= cap) return;
  let oldest: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [id, s] of ledger) {
    if (s.lastEmitAt < oldestAt) {
      oldestAt = s.lastEmitAt;
      oldest = id;
    }
  }
  if (oldest !== null) ledger.delete(oldest);
}
```

- [ ] **1.4 GREEN** — same command, all pass. **1.5 Commit** — `git add packages/app/src/shared/ipc.ts packages/app/src/main/quota/parse.ts packages/app/src/main/quota/parse.test.ts && git commit -m "feat(usage): SessionUsage parsing + capped ledger fold (pure)"`

---

### Task 2: Ledger wiring + `usage:get` IPC

**Files:** Modify `packages/app/src/main/quota/watch.ts`, `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts`. (Thin wiring — covered by Task 1's pure tests + typecheck.)

- [ ] **2.1 watch.ts** — import `parseSessionUsage, recordUsage` and `SessionUsage`; add module state + accessor:

```ts
// Per-session usage ledger for the Usage dashboard: latest snapshot per
// session since launch (capped; oldest-emit evicted). Unlike the tracker it
// is NOT pruned on idle -- history is the point.
let usageLedger = new Map<string, SessionUsage>();

export function getUsageLedger(): SessionUsage[] {
  return [...usageLedger.values()].sort(
    (a, b) => b.totalOutputTokens - a.totalOutputTokens,
  );
}
```

In `readAndBroadcast`, right after `const status = parseQuota(text, emitAt);`:

```ts
  const usage = parseSessionUsage(text, emitAt);
  if (usage) recordUsage(usageLedger, usage);
```

In `stopQuotaWatch`, alongside `tracker = new QuotaTracker();`: `usageLedger = new Map();`

- [ ] **2.2 ipc.ts** — import `getUsageLedger` from `./quota/watch` (extend the existing import) and register next to `quota:get`:

```ts
  ipcMain.handle("usage:get", () => getUsageLedger());
```

- [ ] **2.3 preload** — next to `quotaGet`: `usageGet: () => ipcRenderer.invoke("usage:get"),`

- [ ] **2.4 Verify + commit** — `npm run typecheck` clean; `git add -A packages/app/src/main packages/app/src/preload && git commit -m "feat(usage): per-session ledger in the quota watcher + usage:get IPC"`

---

### Task 3: Renderer aggregation/format helpers

**Files:** Create `packages/app/src/renderer/src/lib/usageFormat.ts` + `packages/app/src/renderer/src/lib/usageFormat.test.ts`.

- [ ] **3.1 Failing tests**:

```ts
import { describe, expect, it } from "vitest";
import type { SessionUsage } from "../../shared/ipc";
import {
  aggregateByModel,
  formatApiTime,
  formatTokens,
  formatUsd,
} from "./usageFormat";

const mk = (over: Partial<SessionUsage>): SessionUsage => ({
  sessionId: "s",
  cwd: null,
  model: null,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  costUsd: 0,
  apiMs: 0,
  linesAdded: 0,
  linesRemoved: 0,
  lastEmitAt: 0,
  ...over,
});

describe("aggregateByModel", () => {
  it("groups, sums, and sorts by output tokens", () => {
    const rows = aggregateByModel([
      mk({ sessionId: "a", model: "Fable 5", totalOutputTokens: 10, costUsd: 1 }),
      mk({ sessionId: "b", model: "Fable 5", totalOutputTokens: 5, costUsd: 0.5 }),
      mk({ sessionId: "c", model: "Opus 4.8", totalOutputTokens: 100 }),
      mk({ sessionId: "d", model: null, totalOutputTokens: 1 }),
    ]);
    expect(rows.map((r) => r.model)).toEqual(["Opus 4.8", "Fable 5", "unknown"]);
    const fable = rows[1];
    expect(fable).toMatchObject({ sessions: 2, outputTokens: 15, costUsd: 1.5 });
  });
});

describe("formatters", () => {
  it("formatTokens scales units", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_340)).toBe("12.3k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
  it("formatApiTime renders s / m s", () => {
    expect(formatApiTime(0)).toBe("0s");
    expect(formatApiTime(12_000)).toBe("12s");
    expect(formatApiTime(272_000)).toBe("4m 32s");
  });
  it("formatUsd shows dashes for zero and cents otherwise", () => {
    expect(formatUsd(0)).toBe("—");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(1.25)).toBe("$1.25");
  });
});
```

- [ ] **3.2 RED**, then **3.3 Implement**:

```ts
import type { SessionUsage } from "../../shared/ipc";

export interface ModelAggregate {
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
  apiMs: number;
}

// Group sessions by model (null -> "unknown"), sum the numerics, sort by
// output tokens -- the "what costs more" ordering on subscription plans
// where reported USD is zero.
export function aggregateByModel(sessions: SessionUsage[]): ModelAggregate[] {
  const byModel = new Map<string, ModelAggregate>();
  for (const s of sessions) {
    const model = s.model ?? "unknown";
    const agg = byModel.get(model) ?? {
      model,
      sessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 0,
      apiMs: 0,
    };
    agg.sessions += 1;
    agg.inputTokens += s.totalInputTokens;
    agg.outputTokens += s.totalOutputTokens;
    agg.cacheReadTokens += s.cacheReadTokens;
    agg.cacheCreateTokens += s.cacheCreateTokens;
    agg.costUsd += s.costUsd;
    agg.apiMs += s.apiMs;
    byModel.set(model, agg);
  }
  return [...byModel.values()].sort((a, b) => b.outputTokens - a.outputTokens);
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatApiTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatUsd(n: number): string {
  if (n <= 0) return "—";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
```

- [ ] **3.4 GREEN + commit** — `git add packages/app/src/renderer/src/lib/usageFormat.ts packages/app/src/renderer/src/lib/usageFormat.test.ts && git commit -m "feat(usage): per-model aggregation + token/time/usd formatters"`

---

### Task 4: Overlay page + meter click-through + CSS

**Files:** Modify `packages/app/src/renderer/src/store.ts` (window-level flag), `components/QuotaMeter.tsx`, `App.tsx`, `theme.css`; Create `components/UsageTab.tsx`.

- [ ] **4.1 store** — in the window-level block (next to `searchOpen`): declare `usageOpen: boolean;` + `setUsageOpen: (v: boolean) => void;`; initial `usageOpen: false,`; impl `setUsageOpen: (usageOpen) => set({ usageOpen }),`.

- [ ] **4.2 QuotaMeter** — each rendered card becomes a button that opens the page. Replace the three `<div className="quota-meter">…</div>` roots with:

```tsx
<button
  type="button"
  className="quota-meter"
  title="Open usage details"
  onClick={() => useApp.getState().setUsageOpen(true)}
>
```

(keep inner content identical; the live card keeps its existing model tooltip by merging: `title={quota.model ? `${quota.model} — open usage details` : "Open usage details"}`).

- [ ] **4.3 UsageTab.tsx**:

```tsx
import { useEffect, useState } from "react";
import type { SessionUsage } from "../../../shared/ipc";
import { clampPct, formatCountdown } from "../lib/quotaFormat";
import {
  aggregateByModel,
  formatApiTime,
  formatTokens,
  formatUsd,
} from "../lib/usageFormat";
import { useApp } from "../store";

const LIVE_WITHIN_S = 20;
const basename = (p: string | null): string =>
  p ? (p.split("/").pop() ?? p) : "—";

// Full-page, window-level Usage view (the data is account-wide, like the
// meter that opens it). Polls usage:get while open; Esc or the close button
// dismisses it.
export function UsageTab() {
  const usageOpen = useApp((s) => s.usageOpen);
  if (!usageOpen) return null;
  return <UsageInner />;
}

function UsageInner() {
  const setUsageOpen = useApp((s) => s.setUsageOpen);
  const quota = useApp((s) => s.quota);
  const [sessions, setSessions] = useState<SessionUsage[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void window.airlock
        .usageGet()
        .then((u) => {
          if (!cancelled) setSessions(u);
        })
        .catch(console.error);
    load();
    const id = setInterval(() => {
      load();
      setTick((t) => t + 1);
    }, 2000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUsageOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [setUsageOpen]);

  const now = Math.floor(Date.now() / 1000);
  const models = aggregateByModel(sessions);

  const windowRow = (label: string, pct: number, resetsAt: number) => (
    <div className="quota-row usage-scale">
      <span className="quota-row-label">{label}</span>
      <span className="quota-bar" aria-hidden>
        <span className="quota-bar-fill" style={{ width: `${clampPct(pct)}%` }} />
      </span>
      <span className="quota-pct">{Math.round(pct)}%</span>
      <span className="usage-reset">
        resets {formatCountdown(resetsAt - now)}
      </span>
    </div>
  );

  return (
    <div className="usage-overlay">
      <div className="settings-tab-header">
        <span>Usage</span>
        <button
          type="button"
          className="viewer-close"
          title="Close usage"
          onClick={() => setUsageOpen(false)}
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
      <div className="usage-body">
        <section className="usage-section">
          <h3>Plan windows</h3>
          {quota?.fiveHour &&
            windowRow("5h", quota.fiveHour.usedPercentage, quota.fiveHour.resetsAt)}
          {quota?.sevenDay &&
            windowRow("7d", quota.sevenDay.usedPercentage, quota.sevenDay.resetsAt)}
          {!quota?.available && (
            <p className="settings-note">
              No account data yet — send a message in any Claude session.
            </p>
          )}
        </section>

        <section className="usage-section">
          <h3>By model</h3>
          {models.length === 0 ? (
            <p className="settings-note">
              No sessions seen since AirLock started — open a Claude terminal.
            </p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Sessions</th>
                  <th className="num">Input</th>
                  <th className="num">Output</th>
                  <th className="num">Cache read</th>
                  <th className="num">Cache write</th>
                  <th className="num">API time</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td className="num">{m.sessions}</td>
                    <td className="num">{formatTokens(m.inputTokens)}</td>
                    <td className="num">{formatTokens(m.outputTokens)}</td>
                    <td className="num">{formatTokens(m.cacheReadTokens)}</td>
                    <td className="num">{formatTokens(m.cacheCreateTokens)}</td>
                    <td className="num">{formatApiTime(m.apiMs)}</td>
                    <td className="num">{formatUsd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="usage-section">
          <h3>Sessions (since AirLock launched)</h3>
          {sessions.length > 0 && (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Model</th>
                  <th className="num">Input</th>
                  <th className="num">Output</th>
                  <th className="num">API time</th>
                  <th className="num">± lines</th>
                  <th className="num">Cost</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.sessionId}>
                    <td title={s.cwd ?? undefined}>{basename(s.cwd)}</td>
                    <td>{s.model ?? "unknown"}</td>
                    <td className="num">{formatTokens(s.totalInputTokens)}</td>
                    <td className="num">{formatTokens(s.totalOutputTokens)}</td>
                    <td className="num">{formatApiTime(s.apiMs)}</td>
                    <td className="num">
                      +{s.linesAdded} −{s.linesRemoved}
                    </td>
                    <td className="num">{formatUsd(s.costUsd)}</td>
                    <td>
                      <span
                        className={`status-dot${now - s.lastEmitAt <= LIVE_WITHIN_S ? " running" : ""}`}
                        title={
                          now - s.lastEmitAt <= LIVE_WITHIN_S
                            ? "live"
                            : `last emit ${formatCountdown(now - s.lastEmitAt)} ago`
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="settings-note">
          Token counts and costs come from each Claude Code session's own
          reporting. — under Cost means the session reports $0 (covered by
          your subscription plan).
        </p>
      </div>
    </div>
  );
}
```

- [ ] **4.4 App.tsx** — import `UsageTab` and render `<UsageTab />` next to `<Palette />`.

- [ ] **4.5 CSS** (theme.css):

```css
/* Full-page Usage overlay: below the titlebar, above the panes; the status
   bar stays visible (bottom inset = its 22px row). */
.usage-overlay {
  position: fixed;
  top: 38px;
  left: 0;
  right: 0;
  bottom: 22px;
  z-index: 25;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

.usage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 900px;
}

.usage-section h3 {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-dim);
}

.usage-scale .quota-bar {
  height: 8px;
  border-radius: 4px;
}

.usage-scale {
  max-width: 420px;
}

.usage-reset {
  flex: none;
  font-size: 11px;
  color: var(--fg-dim);
  margin-left: 8px;
}

.usage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.usage-table th,
.usage-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}

.usage-table th {
  color: var(--fg-dim);
  font-weight: 500;
}

.usage-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* The meter card is now a click-through button; keep its layout, add
   affordance. (It inherits border-top from the original rule.) */
button.quota-meter {
  appearance: none;
  width: 100%;
  background: none;
  text-align: left;
  border-left: none;
  border-right: none;
  border-bottom: none;
  cursor: pointer;
  font: inherit;
}

button.quota-meter:hover {
  background: var(--hover);
}
```

- [ ] **4.6 Gates** — `npm test && npm run typecheck && npm run lint` (QuotaMeter tests keep passing — text queries unaffected by div→button; biome `--write` for ordering). **4.7 Commit** — `git add -A packages/app/src/renderer && git commit -m "feat(usage): full-page usage dashboard opened from the quota meter"`

---

### Task 5: Docs + finish

- [ ] **5.1** Spec status += `Implemented.`; CLAUDE.md quota section gains one line: clicking the meter opens the window-level Usage page (`usage:get` ledger in `watch.ts`).
- [ ] **5.2** Full gates green → commit docs → finishing-a-development-branch (owner picks merge).

---

## Self-review notes

- Spec coverage: type+parse (T1), ledger+IPC (T2), aggregation/formatters (T3), overlay+click+CSS+notes (T4), docs (T5). Empty/error states in T4 JSX. Cap eviction tested (T1).
- Type consistency: `SessionUsage` fields used identically across T1/T3/T4; `usageGet` preload name matches AirlockApi; `getUsageLedger` matches ipc.ts import.
- Convention: watch/ipc/preload wiring untested; all logic pure-tested.
