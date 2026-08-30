// ASCII comments only. How Atlas invokes `claude`. Every flag here was chosen
// by measurement on 2026-08-30, not by taste:
//
//   default (all MCP servers)         ~31K context, $0.0737 for a trivial call
//   --strict-mcp-config               ~21K context, $0.0316
//   + no tools + own --system-prompt  ~13K context
//
// The shape is identical every day, so after the first run it caches. The
// composer reads a snapshot and writes prose; it needs no tools, no MCP
// servers, and none of the agentic system prompt.

export const COMPOSER_MODEL = "claude-sonnet-5";

// Every built-in tool. The composer is handed all the facts it needs on stdin,
// so a tool call would mean it is doing something Atlas did not ask for.
export const COMPOSER_DISALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
  "NotebookEdit",
];

export const COMPOSER_SYSTEM_PROMPT =
  "You summarize a software portfolio for its owner. Be concrete and brief. " +
  "Name projects exactly as given. Never invent activity that is not in the " +
  "input. Prefer one short sentence per project over a list of commits.";

// The prompt is NOT included: it goes on stdin. See the module comment.
// The system prompt is a parameter so the conversation path (Opus, a different
// system prompt) can reuse the identical cost flags rather than duplicate them.
export function buildComposerArgs(
  model: string = COMPOSER_MODEL,
  system: string = COMPOSER_SYSTEM_PROMPT,
): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--system-prompt",
    system,
    "--strict-mcp-config",
    "--disallowed-tools",
    ...COMPOSER_DISALLOWED_TOOLS,
  ];
}
