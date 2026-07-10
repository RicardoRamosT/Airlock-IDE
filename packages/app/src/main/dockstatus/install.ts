// packages/app/src/main/dockstatus/install.ts
// Install/uninstall AirLock's Claude Code hooks in ~/.claude/settings.json.
// Additive (never touches the user's own hooks) and reversible (removes only
// entries whose command carries the airlock-dock-status marker). No unknown JSON
// keys are added -- the "this is AirLock's" label lives in the command string.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DockStatusPaths {
  settingsPath: string; // ~/.claude/settings.json
  bookkeepingPath: string; // <userData>/dockstatus/install.json
  emitConfigPath: string; // <userData>/dockstatus/emit-config.sh (sourced by the emitter)
  sessionsDir: string; // <userData>/dockstatus/sessions
  emitScript: string; // absolute path to airlock-dock-status.sh
}

const EMIT_MARKER = "airlock-dock-status";
const LABEL =
  "AirLock dock-status indicator - safe to remove if AirLock is uninstalled";
const HOOK_EVENTS: { event: string; state: string }[] = [
  { event: "UserPromptSubmit", state: "working" },
  { event: "Stop", state: "done" },
  { event: "Notification", state: "done" },
  { event: "SessionEnd", state: "gone" },
];

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
// Single-quote a path for the POSIX shell Claude Code runs the command in.
function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// The hook command for a state. The script only reads $1 (config) and $2 (state),
// so the trailing "# ..." is either a shell comment (if run via a shell) or
// ignored extra args (if exec-split) -- inert either way, and human-readable.
function hookCommand(p: DockStatusPaths, state: string): string {
  return `/bin/sh ${shQuote(p.emitScript)} ${shQuote(p.emitConfigPath)} ${state}  # ${LABEL}`;
}

function isOurEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const hooks = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) =>
      !!h &&
      typeof h === "object" &&
      typeof (h as { command?: unknown }).command === "string" &&
      (h as { command: string }).command.includes(EMIT_MARKER),
  );
}

function asHooksObject(
  settings: Record<string, unknown>,
): Record<string, unknown[]> {
  const h = settings.hooks;
  return h && typeof h === "object" ? (h as Record<string, unknown[]>) : {};
}

export async function installDockStatusHooks(
  p: DockStatusPaths,
): Promise<void> {
  const settings = (await readJson(p.settingsPath)) ?? {};
  const hooks = asHooksObject(settings);
  for (const { event, state } of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = existing.filter((e) => !isOurEntry(e)); // idempotent: drop our stale one
    kept.push({ hooks: [{ type: "command", command: hookCommand(p, state) }] });
    hooks[event] = kept;
  }
  settings.hooks = hooks;
  await writeJsonAtomic(p.settingsPath, settings);
  await mkdir(p.sessionsDir, { recursive: true });
  await writeTextAtomic(
    p.emitConfigPath,
    `# AirLock dock-status hook config -- sourced by airlock-dock-status.sh\nDIR=${shQuote(p.sessionsDir)}\n`,
  );
  await writeJsonAtomic(p.bookkeepingPath, { installed: true });
}

export async function uninstallDockStatusHooks(
  p: DockStatusPaths,
): Promise<void> {
  const settings = await readJson(p.settingsPath);
  if (settings?.hooks && typeof settings.hooks === "object") {
    const hooks = settings.hooks as Record<string, unknown[]>;
    for (const { event } of HOOK_EVENTS) {
      if (Array.isArray(hooks[event])) {
        const rest = hooks[event].filter((e) => !isOurEntry(e));
        if (rest.length) hooks[event] = rest;
        else delete hooks[event];
      }
    }
    if (Object.keys(hooks).length === 0) {
      delete settings.hooks;
    }
    await writeJsonAtomic(p.settingsPath, settings);
  }
  await rm(p.emitConfigPath, { force: true });
  await writeJsonAtomic(p.bookkeepingPath, { installed: false });
}

export async function isDockStatusInstalled(
  p: DockStatusPaths,
): Promise<boolean> {
  const book = await readJson(p.bookkeepingPath);
  return (book as { installed?: boolean } | null)?.installed === true;
}
