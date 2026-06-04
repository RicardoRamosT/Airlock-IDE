import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface AuditEntry {
  ts: string;
  actor: "user" | "agent";
  op: string;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function auditFile(root: string): string {
  return path.join(root, ".airlock", "audit", "log.jsonl");
}

function computeHash(e: Omit<AuditEntry, "hash">): string {
  const body = JSON.stringify({
    ts: e.ts,
    actor: e.actor,
    op: e.op,
    detail: e.detail,
    prevHash: e.prevHash,
  });
  return createHash("sha256").update(body).digest("hex");
}

async function readEntries(root: string): Promise<AuditEntry[]> {
  let text: string;
  try {
    text = await readFile(auditFile(root), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as AuditEntry);
}

export async function appendAudit(
  root: string,
  actor: AuditEntry["actor"],
  op: string,
  detail: Record<string, unknown>,
  nowIso?: string,
): Promise<AuditEntry> {
  const entries = await readEntries(root);
  const prevHash =
    entries.length > 0
      ? (entries[entries.length - 1]?.hash ?? GENESIS)
      : GENESIS;
  const partial = {
    ts: nowIso ?? new Date().toISOString(),
    actor,
    op,
    detail,
    prevHash,
  };
  const entry: AuditEntry = { ...partial, hash: computeHash(partial) };
  await mkdir(path.dirname(auditFile(root)), { recursive: true });
  await appendFile(auditFile(root), `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readAudit(
  root: string,
  limit?: number,
): Promise<AuditEntry[]> {
  const entries = await readEntries(root);
  if (limit === undefined || entries.length <= limit) return entries;
  return entries.slice(entries.length - limit);
}

/**
 * Verifies integrity and linkage of all PRESENT entries. Silent truncation
 * of trailing entries is undetectable by design (no external head pointer).
 */
export async function verifyAuditChain(root: string): Promise<boolean> {
  const entries = await readEntries(root);
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev) return false;
    const { hash, ...rest } = e;
    if (computeHash(rest) !== hash) return false;
    prev = hash;
  }
  return true;
}
