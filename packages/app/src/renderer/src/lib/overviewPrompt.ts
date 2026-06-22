// The generation prompt typed into the project's Claude session. Intentionally
// ONE line: it is written to the pty as a single paste, then the store sends a
// separate Enter (\r) to submit. An embedded newline would land as a literal
// newline in Claude's input (or submit a partial line), so keep it single-line.
export function buildOverviewPrompt(areaPaths: string[]): string {
  const seed = areaPaths.length
    ? areaPaths.join(", ")
    : "(infer from the tree)";
  return (
    "Analyze this project and write/update .airlock/overview.md as the IDE's at-a-glance Overview, " +
    "in GitHub-flavored markdown: start with a one-line summary of what the project is and its primary stack; " +
    "then one `## <Area>` section per area, each with 1-2 sentences on its purpose and role in the data flow, " +
    "plus a short bulleted list of key entry files as markdown links. " +
    "Keep it skimmable and concise — do not restate the full file tree or paste code. " +
    "Describe architecture only: never include secret values, credentials, API keys, tokens, " +
    "connection strings, .env contents, internal hostnames/URLs, or personal data — refer to such " +
    "things by name or role only. " +
    `Areas to cover: ${seed}.`
  );
}
