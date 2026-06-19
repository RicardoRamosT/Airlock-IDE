// Restorable layout snapshot persistence (session.json). Pure read/write keyed
// by an explicit file path so the logic stays electron-free and unit-testable;
// the caller (main) supplies the userData path. Mirrors prefs.ts: serialized
// writes, atomic rename, best-effort (a write failure is logged, never thrown).
// ASCII comments only. SessionSnapshot is the single source of truth in
// ../shared/ipc, imported here as a type.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionSnapshot } from "../shared/ipc";

// Validate the on-disk shape. Anything off (absent, malformed, wrong version,
// wrong field types) -> null, so a corrupt snapshot can never break startup.
function parse(text: string): SessionSnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.tabs)) return null;
  const tabs: { root: string; hadClaude: boolean }[] = [];
  for (const t of r.tabs) {
    if (t && typeof t === "object") {
      const tt = t as Record<string, unknown>;
      if (typeof tt.root === "string" && typeof tt.hadClaude === "boolean") {
        tabs.push({ root: tt.root, hadClaude: tt.hadClaude });
      }
    }
  }
  const activeRoot = typeof r.activeRoot === "string" ? r.activeRoot : null;
  let split: { a: string; b: string } | null = null;
  if (r.split && typeof r.split === "object") {
    const s = r.split as Record<string, unknown>;
    if (typeof s.a === "string" && typeof s.b === "string") {
      split = { a: s.a, b: s.b };
    }
  }
  return { version: 1, tabs, activeRoot, split };
}

export async function readSession(
  file: string,
): Promise<SessionSnapshot | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null; // absent -> no snapshot (normal first run)
  }
  return parse(text);
}

// Serialize writes per file (mirrors prefs.ts) so concurrent saves cannot
// interleave; best-effort (errors logged, never thrown).
const writeQueues = new Map<string, Promise<unknown>>();

export function writeSession(
  file: string,
  snap: SessionSnapshot,
): Promise<void> {
  const prev = writeQueues.get(file) ?? Promise.resolve();
  const run = prev.then(
    () => writeNow(file, snap),
    () => writeNow(file, snap),
  );
  writeQueues.set(
    file,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function writeNow(file: string, snap: SessionSnapshot): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(snap, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tmp, file);
  } catch (err) {
    console.error("[airlock] session.json write failed", err);
  }
}
