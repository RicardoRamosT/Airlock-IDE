// ASCII comments only. One conversational turn's prompt.
//
// Atlas owns its history and RESENDS it, rather than using --resume and Claude
// Code's session files. The memory belongs in Atlas's store with everything
// else it remembers, and no external session state can then drift or vanish.
// History is capped because a conversation is what the user does most, and the
// prompt is what Atlas pays for.

import type { RootSnapshot } from "./collect";
import { type AtlasFact, liveFacts } from "./facts";
import { FACTS_CLOSE, FACTS_OPEN } from "./reply";

export const CHAT_MODEL = "claude-opus-5";
export const MAX_HISTORY_TURNS = 20;

export const CHAT_SYSTEM_PROMPT =
  "You are Atlas, an administrator for one developer's project portfolio. " +
  "You answer questions about their projects and help them decide what to work " +
  "on. Be concrete and brief. Never invent activity or facts that are not in " +
  "the input.\n\n" +
  "You have NO tools and cannot run anything. Never say you scanned, checked, " +
  "searched, ran a job, or looked at a folder -- you did none of it. " +
  "Everything you know is in this prompt. If the portfolio section is empty, " +
  "say the collector returned nothing, and do NOT ask the user to paste their " +
  "projects in by hand; that is a bug for them to report, not work for them " +
  "to do.\n\n" +
  "When the user tells you something durable that the code cannot show -- a " +
  "deadline, a priority, a project being dead or blocked -- record it by " +
  `ending your reply with a block:\n${FACTS_OPEN}\n` +
  '[{"project":"<name or null>","kind":"deadline|priority|status|blocker|note",' +
  '"value":"<short canonical value>","verbatim":"<the user\'s own words>"}]\n' +
  `${FACTS_CLOSE}\n` +
  "Quote the user verbatim; do not paraphrase. Emit the block ONLY when the " +
  "user actually told you something new. Most turns need no block at all.";

export interface Turn {
  role: "user" | "atlas";
  text: string;
}

function portfolio(snaps: readonly RootSnapshot[]): string {
  const lines = snaps.map((s) => {
    if (s.missing) return `- ${s.root}: missing`;
    if (!s.isRepo) return `- ${s.root}: not a git repository`;
    const bits = [`branch ${s.branch ?? "?"}`];
    if (s.upstream === null) bits.push("no remote");
    else if (s.ahead > 0) bits.push(`${s.ahead} unpushed`);
    if (s.dirty > 0) bits.push(`${s.dirty} uncommitted`);
    if (s.commits.length > 0) bits.push(`${s.commits.length} recent commits`);
    return `- ${s.root}: ${bits.join(", ")}`;
  });
  return lines.join("\n");
}

export function buildChatPrompt(input: {
  history: readonly Turn[];
  facts: readonly AtlasFact[];
  snaps: readonly RootSnapshot[];
  question: string | null;
  message: string;
}): string {
  const parts: string[] = ["PORTFOLIO:", portfolio(input.snaps), ""];

  const live = liveFacts(input.facts);
  if (live.length > 0) {
    parts.push("WHAT YOU HAVE BEEN TOLD:");
    for (const f of live) {
      const who = f.project ?? "(portfolio)";
      parts.push(
        `- ${who} ${f.kind}: ${f.value} -- they said: "${f.verbatim}"`,
      );
    }
    parts.push("");
  }

  // Most recent turns only, oldest first so the exchange reads in order.
  const recent = input.history.slice(-MAX_HISTORY_TURNS);
  if (recent.length > 0) {
    parts.push("CONVERSATION SO FAR:");
    for (const t of recent) {
      parts.push(`${t.role === "user" ? "User" : "Atlas"}: ${t.text}`);
    }
    parts.push("");
  }

  if (input.question !== null) {
    parts.push(
      `Also ask this, once, at the end of your reply: ${input.question}`,
      "",
    );
  }

  parts.push(`User: ${input.message}`);
  return parts.join("\n");
}
