// Pure helpers for the main-side Claude-activity monitor (Feature A). They turn
// a `ps -axo pid=,ppid=,command=` snapshot plus per-session last-output
// timestamps into a per-session "is claude working" boolean. ASCII-only: this
// module is CJS-bundled into the Electron main process (cjs_lexer crashes on
// multibyte). No Electron, no I/O -- the caller runs ps; this just parses.

// Parse `ps -axo pid=,ppid=,command=` output into a parent-pid -> child command
// lines map. Each line: leading ws, pid, ws, ppid, ws, then the full command
// (which itself contains spaces), e.g. "  4321  4319 node /x/claude/cli.js".
// Lines that do not start with two numeric tokens are skipped.
export function parsePsChildren(psStdout: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const rawLine of psStdout.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    // First two whitespace tokens are pid + ppid; the REST (which itself
    // contains spaces) is the command.
    const m = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const ppid = Number(m[2]);
    const command = m[3] ?? "";
    if (!Number.isFinite(ppid)) continue;
    const list = out.get(ppid);
    if (list) list.push(command);
    else out.set(ppid, [command]);
  }
  return out;
}

// Does any of a shell's child command lines look like the `claude` CLI? Match
// the program/arg basename === "claude" (catches `claude`,
// `/usr/local/bin/claude`, and `claude` passed as an arg), NOT a mere path
// substring (so a project path containing "claude" does not false-positive).
export function commandsIncludeClaude(commands: string[]): boolean {
  return commands.some((c) =>
    c.split(/\s+/).some((t) => (t.split("/").pop() ?? t) === "claude"),
  );
}

// Output quiet longer than this => the claude process is idle (at the prompt /
// finished), so the session is reported as NOT working.
export const CLAUDE_WORKING_QUIET_MS = 1200;

// Compute per-session working from a ps snapshot + last-output timestamps.
// working = the session's shell pid has a claude child AND it produced output
// within CLAUDE_WORKING_QUIET_MS of `now`.
export function computeSessionWorking(
  psStdout: string,
  sessions: { id: string; pid: number }[],
  lastOutput: Map<string, number>,
  now: number,
): { id: string; working: boolean }[] {
  const children = parsePsChildren(psStdout);
  return sessions.map(({ id, pid }) => {
    const hasClaude = commandsIncludeClaude(children.get(pid) ?? []);
    const recent = now - (lastOutput.get(id) ?? 0) <= CLAUDE_WORKING_QUIET_MS;
    return { id, working: hasClaude && recent };
  });
}
