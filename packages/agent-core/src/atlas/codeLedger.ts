// ASCII comments only. Everything that happened to a project's CODE in the
// window, enumerated rather than summarised.
//
// The reporter (a model) writes narrative. This is the half that must not
// depend on a model remembering anything: the debrief renders these counts and
// identifiers itself, so a merged PR the model forgot to mention is still on
// the page.
//
// Every field is a Probe, not a value. "No PRs" and "could not ask about PRs"
// are different answers and the debrief says which one it has. That is the
// three-state rule CLAUDE.md already applies to loading UI, applied to data.

import type { CommitEntry } from "./activity";

export type Probe<T> =
  | { ok: true; value: T; withheld?: number }
  | { ok: false; reason: string };

// Ceilings exist only against the pathological case -- a rebase, a long-lived
// branch merged at once. They are set high enough that in normal use they never
// fire, and when they do the count withheld is reported.
export const CEILING_COMMITS = 1000;
export const CEILING_GH = 200;

export interface TreeState {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: number;
}

export interface PrEvent {
  number: number;
  title: string;
  state: string; // OPEN | MERGED | CLOSED
  updatedAt: number;
  url: string;
}

export interface CiRunSummary {
  workflowName: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  url: string;
  at: number;
}

export interface IssueEvent {
  number: number;
  title: string;
  state: string;
  updatedAt: number;
  url: string;
}

export interface ReleaseEvent {
  tag: string;
  name: string;
  publishedAt: number;
  url: string;
}

export interface CodeLedger {
  root: string;
  sinceMs: number;
  untilMs: number;
  capped: boolean; // the WINDOW cap fired, not a ceiling
  tree: Probe<TreeState>;
  commits: Probe<CommitEntry[]>;
  prs: Probe<PrEvent[]>;
  runs: Probe<CiRunSummary[]>;
  issues: Probe<IssueEvent[]>;
  releases: Probe<ReleaseEvent[]>;
}

export function capItems<T>(
  items: readonly T[],
  ceiling: number,
): { items: T[]; withheld: number } {
  if (items.length <= ceiling) return { items: [...items], withheld: 0 };
  return { items: items.slice(0, ceiling), withheld: items.length - ceiling };
}

function rows(raw: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object",
  );
}

function at(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function parsePrList(raw: string, sinceMs: number): PrEvent[] {
  const out: PrEvent[] = [];
  for (const r of rows(raw)) {
    const updatedAt = at(r.updatedAt);
    const title = str(r.title);
    if (typeof r.number !== "number" || updatedAt === null || title === null)
      continue;
    if (updatedAt < sinceMs) continue;
    out.push({
      number: r.number,
      title,
      state: str(r.state) ?? "UNKNOWN",
      updatedAt,
      url: str(r.url) ?? "",
    });
  }
  return out;
}

export function parseRunList(raw: string, sinceMs: number): CiRunSummary[] {
  const out: CiRunSummary[] = [];
  for (const r of rows(raw)) {
    const ms = at(r.createdAt);
    const workflowName = str(r.workflowName);
    if (ms === null || workflowName === null) continue;
    if (ms < sinceMs) continue;
    out.push({
      workflowName,
      status: str(r.status) ?? "unknown",
      // null is MEANINGFUL here: the run has not concluded yet.
      conclusion: str(r.conclusion),
      headBranch: str(r.headBranch) ?? "",
      url: str(r.url) ?? "",
      at: ms,
    });
  }
  return out;
}

export function parseIssueList(raw: string, sinceMs: number): IssueEvent[] {
  const out: IssueEvent[] = [];
  for (const r of rows(raw)) {
    const updatedAt = at(r.updatedAt);
    const title = str(r.title);
    if (typeof r.number !== "number" || updatedAt === null || title === null)
      continue;
    if (updatedAt < sinceMs) continue;
    out.push({
      number: r.number,
      title,
      state: str(r.state) ?? "UNKNOWN",
      updatedAt,
      url: str(r.url) ?? "",
    });
  }
  return out;
}

export function parseReleaseList(raw: string, sinceMs: number): ReleaseEvent[] {
  const out: ReleaseEvent[] = [];
  for (const r of rows(raw)) {
    const publishedAt = at(r.publishedAt);
    const tag = str(r.tagName);
    if (publishedAt === null || tag === null) continue;
    if (publishedAt < sinceMs) continue;
    out.push({
      tag,
      name: str(r.name) ?? tag,
      publishedAt,
      url: str(r.url) ?? "",
    });
  }
  return out;
}

// A project with nothing in the window gets no reporter call and no section.
// A FAILED probe is not quiet: we do not know, and the debrief must say so.
export function ledgerIsQuiet(l: CodeLedger): boolean {
  const probes = [l.commits, l.prs, l.runs, l.issues, l.releases];
  for (const p of probes) {
    if (!p.ok) return false;
    if (p.value.length > 0) return false;
  }
  if (!l.tree.ok) return false;
  return l.tree.value.dirty === 0 && l.tree.value.ahead === 0;
}
