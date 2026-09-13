// ASCII comments only. What one project is asked, and how its answer is read.
//
// The reporter is handed facts AND memory and asked for narrative only. It is
// told never to produce a number: the debrief renders counts from the ledger
// itself, so a model that forgets a merged PR cannot remove it from the page.
//
// `gaps` exists so uncertainty has somewhere to go that is not `did`, where it
// would read as fact.

import type { CodeLedger, Probe } from "./codeLedger";
import { projectName } from "./registry";
import type { SessionDigest } from "./sessions";

export interface ProjectReport {
  root: string;
  did: string[];
  standing: string[];
  gaps: string[];
}

export const REPORTER_SYSTEM_PROMPT =
  "You report on one software project's day to an assistant that is writing " +
  "its owner a debrief. You are given the project's complete code record and " +
  "the memory of its coding sessions. Answer ONLY with JSON of the shape " +
  '{"did":[],"standing":[],"gaps":[]}. "did" is what the work actually was, ' +
  'at most 3 short sentences. "standing" is where it stands now -- what is ' +
  'half-done, blocked, or waiting -- at most 3. "gaps" is anything you could ' +
  "not determine. Never state a count, a commit hash, a PR number or a date: " +
  "those are rendered from the record, not from you. Never invent activity.";

function probeLine<T>(
  label: string,
  p: Probe<T[]>,
  render: (v: T[]) => string,
): string {
  if (!p.ok) return `${label}: COULD NOT BE READ (${p.reason})`;
  if (p.value.length === 0) return `${label}: none`;
  const more = p.withheld ? ` (+${p.withheld} more not listed)` : "";
  return `${label}: ${render(p.value)}${more}`;
}

export function buildReportPrompt(
  ledger: CodeLedger,
  digests: readonly SessionDigest[],
): string {
  const name = projectName(ledger.root);
  const since = new Date(ledger.sinceMs).toISOString().slice(0, 16);
  const until = new Date(ledger.untilMs).toISOString().slice(0, 16);

  const out: string[] = [
    `Project: ${name}`,
    `Window: ${since} to ${until}${ledger.capped ? " (capped; earlier work not shown)" : ""}`,
    "",
    "CODE RECORD (complete, already verified -- do not restate its numbers):",
  ];

  out.push(
    ledger.tree.ok
      ? `  tree: branch ${ledger.tree.value.branch ?? "?"}, ${ledger.tree.value.ahead} unpushed, ${ledger.tree.value.dirty} uncommitted files`
      : `  tree: COULD NOT BE READ (${ledger.tree.reason})`,
  );
  out.push(
    `  ${probeLine(
      "commits",
      ledger.commits,
      (v) =>
        `\n${v.map((c) => `    ${c.subject.split("\n")[0] ?? ""}`).join("\n")}`,
    )}`,
  );
  out.push(
    `  ${probeLine("pull requests", ledger.prs, (v) => v.map((p) => `#${p.number} ${p.state} ${p.title}`).join("; "))}`,
  );
  out.push(
    `  ${probeLine("ci runs", ledger.runs, (v) => v.map((r) => `${r.workflowName} ${r.conclusion ?? r.status}`).join("; "))}`,
  );
  out.push(
    `  ${probeLine("issues", ledger.issues, (v) => v.map((i) => `#${i.number} ${i.state} ${i.title}`).join("; "))}`,
  );
  out.push(
    `  ${probeLine("releases", ledger.releases, (v) => v.map((r) => r.tag).join("; "))}`,
  );

  out.push("", "SESSION MEMORY:");
  if (digests.length === 0) out.push("  no coding sessions in this window");
  for (const d of digests) {
    out.push(
      `  session ${d.title ?? "(untitled)"} -- ${d.userMessages} messages, ` +
        `${new Date(d.startedAt).toISOString().slice(0, 16)} to ${new Date(d.endedAt).toISOString().slice(0, 16)}`,
    );
    for (const s of d.compactSummaries) out.push(`    summary: ${s}`);
    if (d.lastPrompt) out.push(`    last asked: ${d.lastPrompt}`);
    if (d.tail)
      out.push(
        `    tail:\n${d.tail
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n")}`,
      );
  }

  out.push("", "Reply with the JSON object and nothing else.");
  return out.join("\n");
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

export function parseReport(root: string, raw: string): ProjectReport | null {
  // Models fence JSON whatever you tell them, so take the widest brace span.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (!("did" in o) && !("standing" in o)) return null;
  return {
    root,
    did: strings(o.did),
    standing: strings(o.standing),
    gaps: strings(o.gaps),
  };
}
