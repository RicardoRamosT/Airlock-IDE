import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Every path the installer needs. Supplied by wire.ts (electron-aware) so this
// module stays electron-free and unit-testable, mirroring prefs.ts.
export interface QuotaPaths {
  settingsPath: string; // ~/.claude/settings.json
  bookkeepingPath: string; // <userData>/quota/install.json (main-only state)
  emitConfigPath: string; // <userData>/quota/emit-config.sh (shell-sourceable; read by the emitter)
  outPath: string; // <userData>/quota/rate-limits.json (side-channel)
  emitScript: string; // absolute path to statusline-emit.sh
}

// A statusLine command is OURS iff it references our emitter script. Matches both
// the current shell emitter (statusline-emit.sh) AND the legacy node one
// (statusline-emit.cjs), so an upgrade replaces the legacy command instead of
// mistaking it for the user's prior statusLine and chaining to it.
const EMIT_MARKER = "statusline-emit";

// Re-run the statusLine (hence our emitter) every N seconds while a Claude
// session is open, in addition to event-driven runs. This keeps the meter live
// when the session is idle AND lets the UI treat a stale side-channel file as
// "no active session" quickly. (Claude Code statusLine.refreshInterval, min 1s.)
const STATUSLINE_REFRESH_SECONDS = 5;

type StatusLine =
  | { type?: string; command?: string; refreshInterval?: number }
  | undefined;
interface Bookkeeping {
  installed: boolean;
  prior: StatusLine | null;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeTextAtomic(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function isOurs(sl: StatusLine): boolean {
  return (
    !!sl && typeof sl.command === "string" && sl.command.includes(EMIT_MARKER)
  );
}

// Single-quote a literal filesystem path for the POSIX shell Claude Code runs
// the statusLine command in. Single quotes (not double) so a path containing
// $, backtick, or " is taken verbatim with no expansion; embedded single quotes
// are escaped the standard '\'' way.
function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// The quota statusLine is a PURE-SHELL siphon, intentionally NOT node.
//
// Diagnosed 2026-06-16: Claude Code's statusLine spawn crashes ANY Node program
// at bootstrap on some machines -- a Node `Utf8Value`/`MaybeStackBuffer` capacity
// assertion (util.h: `(length + 1) <= capacity()`) reached during early
// bootstrap. Reproduced with a trivial `node -e "process.exit(0)"`, real `node`,
// AND Electron-as-node; NOT reproducible by a normal spawn with matched
// env/cwd/argv/stdin/stdio/fds, so the trigger is something in Claude Code's
// spawn we can't replicate. An earlier env-sanitization attempt (`env -i`) did
// NOT help -- the env is not the cause. A shell statusLine sidesteps the whole
// class: `/bin/sh` runs fine; only node crashes.
//
// statusline-emit.sh reads stdin, atomically writes the payload to the
// side-channel, and chains a prior user statusLine -- all in POSIX shell.
// argv[1] is the shell-sourceable config (OUT=..., PRIOR=...). Paths are
// single-quoted so usernames/dirs with shell metacharacters can't break it.
export function buildStatusLineCommand(p: QuotaPaths): string {
  return `/bin/sh ${shQuote(p.emitScript)} ${shQuote(p.emitConfigPath)}`;
}

// The prior user statusLine, reduced to the shell command string the emitter
// chains (empty unless it is a `{ type: "command", command }` statusLine).
function priorCommand(prior: StatusLine | null): string {
  return prior && prior.type === "command" && typeof prior.command === "string"
    ? prior.command
    : "";
}

export async function installQuotaStatusLine(p: QuotaPaths): Promise<void> {
  const settings = (await readJson(p.settingsPath)) ?? {};
  const current = settings.statusLine as StatusLine;
  const book = (await readJson(
    p.bookkeepingPath,
  )) as unknown as Bookkeeping | null;
  // Capture the user's prior statusLine ONCE. On re-install reuse the saved
  // prior so we never lose it or chain to our own command.
  const prior: StatusLine | null = book?.installed
    ? book.prior
    : isOurs(current)
      ? (book?.prior ?? null)
      : (current ?? null);
  settings.statusLine = {
    type: "command",
    command: buildStatusLineCommand(p),
    refreshInterval: STATUSLINE_REFRESH_SECONDS,
  };
  await writeJsonAtomic(p.settingsPath, settings);
  // emit-config is shell-sourceable (sourced by statusline-emit.sh): OUT is the
  // side-channel path; PRIOR is the prior user statusLine command to chain (empty
  // when there is none). Quoted so paths/commands with metacharacters are verbatim.
  await writeTextAtomic(
    p.emitConfigPath,
    `# AirLock quota statusLine config -- sourced by statusline-emit.sh\n` +
      `OUT=${shQuote(p.outPath)}\n` +
      `PRIOR=${shQuote(priorCommand(prior))}\n`,
  );
  await writeJsonAtomic(p.bookkeepingPath, {
    installed: true,
    prior: prior ?? null,
  } satisfies Bookkeeping);
}

export async function uninstallQuotaStatusLine(p: QuotaPaths): Promise<void> {
  const book = (await readJson(
    p.bookkeepingPath,
  )) as unknown as Bookkeeping | null;
  const settings = (await readJson(p.settingsPath)) ?? {};
  const current = settings.statusLine as StatusLine;
  // Only touch statusLine if it is still ours -- never clobber a value the user
  // set after we installed.
  if (isOurs(current)) {
    const prior = book?.prior;
    if (prior) settings.statusLine = prior;
    else delete settings.statusLine;
    await writeJsonAtomic(p.settingsPath, settings);
  }
  await writeJsonAtomic(p.bookkeepingPath, {
    installed: false,
    prior: undefined,
  } satisfies Bookkeeping);
  await rm(p.emitConfigPath, { force: true });
}

// Whether we currently have a statusLine installed (per our bookkeeping). Lets
// the reconcile skip all disk writes for opt-out users who never enabled it, so
// the feature stays a true no-op until turned on.
export async function isQuotaInstalled(p: QuotaPaths): Promise<boolean> {
  const book = (await readJson(
    p.bookkeepingPath,
  )) as unknown as Bookkeeping | null;
  return book?.installed === true;
}
