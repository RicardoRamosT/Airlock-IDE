// ASCII comments only. Turn a snapshot into the text the composer reads.
//
// Two caps matter. Per project, because one busy repository would otherwise
// swamp the rest -- Revaltone-CRM produced 170 commits in a single week on the
// author's machine. And overall, because a user may have hundreds of projects
// and the prompt is what Atlas pays for.
//
// A quiet day still produces a brief that STATES the gap. Silence reads as
// failure, which is exactly how Helm's dead MCP looked from the outside.

import type { RootSnapshot } from "./collect";

export const MAX_COMMITS_PER_PROJECT = 20;
export const MAX_PROMPT_CHARS = 60_000;

function name(root: string): string {
  const parts = root.split("/").filter((p) => p.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : root;
}

function describe(s: RootSnapshot): string {
  if (s.missing)
    return `- ${name(s.root)}: folder is missing (no longer on disk)`;
  if (!s.isRepo) return `- ${name(s.root)}: not a git repository`;

  const bits: string[] = [];
  if (s.branch) bits.push(`branch ${s.branch}`);
  if (s.upstream === null) bits.push("no remote");
  else if (s.ahead > 0) bits.push(`${s.ahead} unpushed commits`);
  if (s.dirty > 0) bits.push(`${s.dirty} uncommitted files`);

  const head = `- ${name(s.root)}: ${bits.length > 0 ? bits.join(", ") : "clean"}`;
  if (s.commits.length === 0) return `${head}; no commits in the window`;

  const shown = s.commits.slice(0, MAX_COMMITS_PER_PROJECT);
  const rest = s.commits.length - shown.length;
  const lines = shown.map((c) => `    ${c.subject.split("\n")[0] ?? ""}`);
  if (rest > 0) lines.push(`    (${rest} more commits not listed)`);
  return `${head}; ${s.commits.length} commits:\n${lines.join("\n")}`;
}

export function buildBriefPrompt(
  snaps: readonly RootSnapshot[],
  sinceMs: number,
  now: number,
): string {
  const since = new Date(sinceMs).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);

  const header =
    `Today is ${today}. Below is the state of every project in my portfolio, ` +
    `with commits since ${since}.\n\n` +
    "Write two short sections.\n" +
    "YESTERDAY: what actually got done, one sentence per project that saw work. " +
    "Compress commits into what they achieved; do not list them.\n" +
    "TODAY: at most three things worth doing, each with a one-line reason drawn " +
    "only from the facts below.\n" +
    "If nothing happened, say so plainly instead of inventing activity.\n\n";

  if (snaps.length === 0) {
    return `${header}There are no projects in the portfolio yet.\n`;
  }

  const anyCommits = snaps.some((s) => s.commits.length > 0);
  const body: string[] = [];
  let used = header.length;
  let dropped = 0;

  for (const s of snaps) {
    const line = `${describe(s)}\n`;
    // Reserve room for the trailing note so the cap is never exceeded.
    if (used + line.length > MAX_PROMPT_CHARS - 200) {
      dropped += 1;
      continue;
    }
    body.push(line);
    used += line.length;
  }

  let tail = "";
  if (dropped > 0)
    tail += `\n(${dropped} further projects omitted for length)\n`;
  if (!anyCommits) tail += "\nThere were no commits anywhere in this window.\n";

  return header + body.join("") + tail;
}
