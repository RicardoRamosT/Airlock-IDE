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

// The conversation HAS TOOLS. The composer deliberately has none -- it
// summarizes a fixed payload -- and reusing its argv here was a mistake: Atlas
// could not read a file, grep a repo, run `git log`, or look anything up, so
// every question outside the daily snapshot got "I cannot know that". The
// portfolio is meant to be a head start, not a ceiling.
//
// Verified headless on 2026-08-30: with these flags a `claude -p` run executed
// git log across four turns with zero permission denials.
export const CHAT_ALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
];

// Reading and searching are free; CHANGING code is not. The spec's boundary
// holds: Atlas reads and decides, AirLock edits. This panel has no diff view,
// no approval step and no undo, so an edit made here would be unreviewable.
export const CHAT_DENIED_TOOLS: readonly string[] = [
  "Write",
  "Edit",
  "NotebookEdit",
];

// `roots` become --add-dir entries: without them Claude Code confines file
// access to the cwd and Atlas cannot read the very projects it administers.
// AirLock's own MCP server, as a --mcp-config payload. This is how Atlas
// reaches the IDE: open a project tab, start a terminal, send a prompt to a
// Claude already running in one. --strict-mcp-config stays, so this is the
// ONLY server it gets -- none of the user's other MCP servers are loaded, and
// the cost measurement behind that flag still holds.
export function airlockMcpConfig(port: number, token: string): string {
  return JSON.stringify({
    mcpServers: {
      airlock: {
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  });
}

export function buildChatArgs(
  roots: readonly string[],
  mcp?: { port: number; token: string },
): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    CHAT_MODEL,
    "--system-prompt",
    CHAT_SYSTEM_PROMPT,
    "--strict-mcp-config",
    ...(mcp ? ["--mcp-config", airlockMcpConfig(mcp.port, mcp.token)] : []),
    "--allowed-tools",
    ...CHAT_ALLOWED_TOOLS,
    // AirLock's MCP tools, so Atlas can drive the IDE rather than only
    // describe it. Named explicitly: --allowed-tools does not wildcard.
    ...(mcp ? ["mcp__airlock"] : []),
    "--disallowed-tools",
    ...CHAT_DENIED_TOOLS,
    ...(roots.length > 0 ? ["--add-dir", ...roots] : []),
  ];
}
export const MAX_HISTORY_TURNS = 20;
// Per project, so one busy repo cannot crowd out the other twenty.
export const MAX_COMMITS_IN_CHAT = 12;

export const CHAT_SYSTEM_PROMPT =
  "You are Atlas, an administrator for one developer's project portfolio. " +
  "You answer questions about their projects and help them decide what to work " +
  "on. Be concrete and brief. Never invent activity or facts that are not in " +
  "the input.\n\n" +
  "You can also DRIVE AIRLOCK through its own tools when they are available: " +
  "list and open project tabs, open a terminal in a project, and send input " +
  "to a Claude already running in one. Prefer doing work yourself with the " +
  "shell; open a tab when the USER should take it over, or when a project " +
  "needs a Claude session of its own. Say what you opened.\n\n" +
  "You CAN read files, search, run shell commands, and search the web. The " +
  "portfolio below is a head start, not a limit: if it does not contain what " +
  "you need -- older history, commit contents, a file, a diff, something " +
  "online -- go and get it rather than saying you cannot know. `git log`, " +
  "`git diff` and `gh` are all available. You cannot write or edit files; " +
  "for that, say what should change and let the user do it in AirLock.\n\n" +
  "You are on macOS and can also capture the screen with `screencapture`, " +
  "which is a normal shell command:\n" +
  "  screenshot            screencapture -x <file>.png\n" +
  "  record for N seconds  screencapture -v -V<N> <file>.mov\n" +
  "  record open-ended     start it with & , keep the PID, and stop it later " +
  "with `kill -INT <pid>` so the file is written properly\n" +
  "Default to ~/Desktop or ~/Movies with a dated filename, tell the user " +
  "exactly where the file is, and say when a recording has started and " +
  "stopped. macOS requires Screen Recording permission for AirLock; if the " +
  "command fails or the file is blank, say that is what to grant rather than " +
  "guessing at another cause.\n\n" +
  "Never claim to have run something you did not actually run. If the " +
  "portfolio section is empty, say the collector returned nothing -- do NOT " +
  "ask the user to paste their projects in by hand.\n\n" +
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
    const head = `- ${s.root}: ${bits.join(", ")}`;
    if (s.commits.length === 0) return head;
    // The commits themselves, not just a count. Rendering only the count is
    // why Atlas said it had "no dates, no commit messages" -- it was telling
    // the truth, because this function was discarding both.
    const shown = s.commits.slice(0, MAX_COMMITS_IN_CHAT);
    const rest = s.commits.length - shown.length;
    const body = shown.map(
      (c) =>
        `    ${new Date(c.at).toISOString().slice(0, 10)}  ${c.subject.split("\n")[0] ?? ""}`,
    );
    if (rest > 0)
      body.push(
        `    (${rest} older commits not listed -- use git log for more)`,
      );
    return `${head}; ${s.commits.length} commits:\n${body.join("\n")}`;
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
