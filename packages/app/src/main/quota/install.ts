import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Every path the installer needs. Supplied by wire.ts (electron-aware) so this
// module stays electron-free and unit-testable, mirroring prefs.ts.
export interface QuotaPaths {
  settingsPath: string; // ~/.claude/settings.json
  bookkeepingPath: string; // <userData>/quota/install.json (main-only state)
  emitConfigPath: string; // <userData>/quota/emit-config.json (read by the emitter)
  outPath: string; // <userData>/quota/rate-limits.json (side-channel)
  execPath: string; // process.execPath (the app's Electron binary)
  emitScript: string; // absolute path to statusline-emit.cjs
}

// A statusLine command is OURS iff it references the emitter script.
const EMIT_MARKER = "statusline-emit.cjs";

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

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, file);
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

// ELECTRON_RUN_AS_NODE makes the app's own Electron binary behave as plain
// node, so no `node`/`jq` on PATH is assumed (packaged-app safe). Paths are
// single-quoted so usernames/dirs with shell metacharacters can't break it.
export function buildStatusLineCommand(p: QuotaPaths): string {
  return `ELECTRON_RUN_AS_NODE=1 ${shQuote(p.execPath)} ${shQuote(p.emitScript)} ${shQuote(p.emitConfigPath)}`;
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
  await writeJsonAtomic(p.emitConfigPath, {
    out: p.outPath,
    prior: prior ?? null,
  });
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
