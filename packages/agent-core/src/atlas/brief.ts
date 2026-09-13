// ASCII comments only. Turn the standup into the text the composer reads.
//
// Two rules, and they are why this file was rewritten:
//
// FACTS ARE DATA. Counts, PR numbers, run conclusions and tags are rendered
// here from the ledger. The reporter's sentences are narrative and sit beside
// them. A model that forgets a merged PR cannot remove it from the page.
//
// NOTHING IS MISSING IN SILENCE. A probe that failed says so. A ceiling that
// fired says how much it withheld. A capped window says it was capped. A quiet
// project is counted. The previous version truncated commits at 20 and dropped
// whole projects past a character budget, both without a word.

import type { CodeLedger, Probe } from "./codeLedger";
import { projectName } from "./registry";
import type { ProjectReport } from "./report";
import type { DebriefWindow } from "./window";

// A guard, not a routine truncation: the debrief now carries per-project
// summaries rather than every commit subject, so this should never fire.
export const MAX_PROMPT_CHARS = 60_000;

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

function listProbe<T>(
  label: string,
  p: Probe<T[]>,
  render: (v: T[]) => string,
): string | null {
  if (!p.ok) return `${label} could not be read (${p.reason})`;
  if (p.value.length === 0) return null;
  const more = p.withheld ? ` (+${p.withheld} more not listed)` : "";
  return `${label}: ${render(p.value)}${more}`;
}

function projectBlock(
  ledger: CodeLedger,
  report: ProjectReport | undefined,
): string {
  const lines: string[] = [`- ${projectName(ledger.root)}`];

  if (ledger.tree.ok) {
    const t = ledger.tree.value;
    const bits = [`branch ${t.branch ?? "?"}`];
    if (t.ahead > 0) bits.push(`${t.ahead} unpushed`);
    if (t.behind > 0) bits.push(`${t.behind} behind`);
    if (t.dirty > 0) bits.push(`${t.dirty} uncommitted files`);
    lines.push(`    ${bits.join(", ")}`);
  } else {
    lines.push(`    working tree could not be read (${ledger.tree.reason})`);
  }

  if (ledger.commits.ok) {
    const n = ledger.commits.value.length;
    const more = ledger.commits.withheld
      ? `, ${ledger.commits.withheld} more not listed`
      : "";
    lines.push(`    ${plural(n, "commit")}${more}`);
  } else {
    lines.push(`    commits could not be read (${ledger.commits.reason})`);
  }

  const rest = [
    listProbe("pull requests", ledger.prs, (v) =>
      v.map((p) => `#${p.number} ${p.state.toLowerCase()}`).join(", "),
    ),
    listProbe("ci", ledger.runs, (v) =>
      v.map((r) => `${r.workflowName} ${r.conclusion ?? r.status}`).join(", "),
    ),
    listProbe("issues", ledger.issues, (v) =>
      v.map((i) => `#${i.number} ${i.state.toLowerCase()}`).join(", "),
    ),
    listProbe("releases", ledger.releases, (v) =>
      v.map((r) => r.tag).join(", "),
    ),
  ].filter((l): l is string => l !== null);
  for (const l of rest) lines.push(`    ${l}`);

  if (report) {
    for (const d of report.did) lines.push(`    did: ${d}`);
    for (const s of report.standing) lines.push(`    stands: ${s}`);
    for (const g of report.gaps) lines.push(`    unclear: ${g}`);
  } else {
    lines.push("    (no session memory for this project; facts only)");
  }
  return lines.join("\n");
}

export function buildBriefPrompt(
  ledgers: readonly CodeLedger[],
  reports: readonly ProjectReport[],
  quiet: number,
  window: DebriefWindow,
  now: number,
): string {
  const byRoot = new Map(reports.map((r) => [r.root, r]));
  const since = new Date(window.sinceMs).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);

  const header =
    `Today is ${today}. Below is a report from every project that saw work ` +
    `since ${since}. Each project's facts were verified; the "did" and ` +
    `"stands" lines were written by that project's own reporter.\n\n` +
    "Write two short sections.\n" +
    "YESTERDAY: what actually got done, one sentence per project that saw " +
    "work. Use the reports; do not list commits.\n" +
    "TODAY: at most three things worth doing, each with a one-line reason " +
    "drawn only from the facts below.\n" +
    "If a project's record says something could not be read, say so plainly " +
    "rather than treating it as nothing.\n" +
    "If nothing happened, say so instead of inventing activity.\n\n";

  const notes: string[] = [];
  if (window.capped)
    notes.push(
      `(The window was capped at 30 days; work before ${since} is not shown.)`,
    );
  if (quiet > 0) notes.push(`(${plural(quiet, "project")} were quiet.)`);

  if (ledgers.length === 0)
    return `${header}No project saw work in this window.\n${notes.join("\n")}\n`;

  const body: string[] = [];
  let used = header.length + notes.join("\n").length + 200;
  let dropped = 0;
  for (const l of ledgers) {
    const block = `${projectBlock(l, byRoot.get(l.root))}\n`;
    if (used + block.length > MAX_PROMPT_CHARS) {
      dropped += 1;
      continue;
    }
    body.push(block);
    used += block.length;
  }
  if (dropped > 0)
    notes.push(`(${plural(dropped, "project")} omitted for length.)`);

  return `${header}${body.join("")}\n${notes.join("\n")}\n`;
}
