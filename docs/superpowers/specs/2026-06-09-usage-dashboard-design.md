# Usage dashboard (click-through from the Plan Usage meter)

**Date:** 2026-06-09
**Status:** Approved by owner via Q&A. Branch feat/usage-dashboard.
Implemented.

Clicking the sidebar's Plan Usage card opens a full-page **Usage** view: the
account's 5h/7d windows plus a live per-model and per-session breakdown of
tokens/cost — "what costs more". On subscription plans Claude Code reports
`total_cost_usd: 0`, so TOKENS lead the comparison; USD shows when non-zero.

## Approach (chosen: A)

The statusLine side-channel already delivers, per emit and per session:
`model`, `cost{total_cost_usd,total_duration_ms,total_api_duration_ms,
total_lines_added,total_lines_removed}`, `context_window{total_input_tokens,
total_output_tokens,current_usage{...cache tokens}}`, `cwd`, `session_id`.
Today everything but rate_limits is discarded. Keep a per-session ledger in
the existing quota watcher and render it. Rejected: parsing
`~/.claude/projects/*.jsonl` transcripts (fragile, heavy) and external
telemetry tools.

## Units

| Unit | Responsibility |
| --- | --- |
| `shared/ipc.ts` | `SessionUsage` type + `AirlockApi.usageGet(): Promise<SessionUsage[]>`. |
| `main/quota/parse.ts` | Pure `parseSessionUsage(text, emitAt): SessionUsage \| null` (null on unparseable JSON / missing session_id). Defensive per field. |
| `main/quota/watch.ts` | Ledger `Map<sessionId, SessionUsage>` updated on every emit (latest snapshot per session, stamped `lastEmitAt`); capped at 50 sessions (oldest-emit evicted); kept since launch (NOT pruned at 120s — history is the point). `getUsageLedger()` export. Cleared by `stopQuotaWatch`. |
| `main/ipc.ts` | `usage:get` handle → ledger sorted by `totalOutputTokens` desc. |
| `preload` | `usageGet` passthrough. |
| `store.ts` | Window-level `usageOpen: boolean` + `setUsageOpen` (NOT per-tab: the data is account-wide, so it lives beside palette/search, avoiding the ProjectState overlay plumbing). |
| `components/QuotaMeter.tsx` | The card becomes a button (`title="Open usage details"`); click → `setUsageOpen(true)`. Same in its waiting states. |
| `components/UsageTab.tsx` (**new**) | Full-page overlay below the titlebar (`.usage-overlay`, fixed, top:38px, z-index above panes): header (title + ✕, Esc closes), account 5h/7d bars from the store quota, **per-model aggregate table** (sessions, in/out/cache-read/cache-write tokens, API time, USD), **session table** (project basename, model, live dot when `lastEmitAt` ≤ 20s, tokens, API time, lines ±, USD, last active). Polls `usageGet` every 2s while open. Footer notes: data since AirLock launch; $0 = subscription-covered session. |
| `theme.css` | `.usage-*` table/page styles in the settings-tab visual family. |

## SessionUsage shape

```ts
interface SessionUsage {
  sessionId: string;
  cwd: string | null;          // project dir at last emit
  model: string | null;        // display_name preferred
  totalInputTokens: number;    // context_window.total_input_tokens (0 if absent)
  totalOutputTokens: number;
  cacheReadTokens: number;     // current_usage.cache_read_input_tokens
  cacheCreateTokens: number;   // current_usage.cache_creation_input_tokens
  costUsd: number;             // cost.total_cost_usd
  apiMs: number;               // cost.total_api_duration_ms
  linesAdded: number;
  linesRemoved: number;
  lastEmitAt: number;          // epoch s (file mtime at parse)
}
```

Aggregation by model happens in the RENDERER (pure helper `aggregateByModel`
in `lib/usageFormat.ts`, unit-tested, with `formatTokens` 1234→"1.2k").

## Error handling

- Emits without `context_window`/`cost` → zeros (session still listed).
- Ledger empty → page shows the account bars + "No sessions seen since
  AirLock started — open a Claude terminal."
- Quota disabled (`quotaMeterEnabled` false) → meter hidden, page unreachable;
  no special casing.

## Testing

- `parse.ts`: parseSessionUsage happy path (real payload shape), missing
  cost/context_window → zeros, garbage → null.
- Ledger: latest-per-session wins, 50-cap evicts oldest emit.
- `lib/usageFormat.ts`: aggregateByModel sums + groups "unknown" null models;
  formatTokens units.
- Store: usageOpen toggle. Components thin/untested (convention); smoke stays
  green (overlay closed by default).

## Out of scope

- Cross-restart persistence (possible follow-up: JSONL ledger in userData),
  transcript parsing, charts, CSV export.
