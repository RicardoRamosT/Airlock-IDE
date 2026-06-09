import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AuditEntry,
  appendAudit,
  appendAuditAt,
  readAudit,
  verifyAuditChain,
} from "./audit";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-audit-"));
});

describe("audit", () => {
  it("appends entries with a verifiable hash chain", async () => {
    await appendAudit(root, "user", "secret.set", { name: "A" });
    await appendAudit(root, "user", "secret.set", { name: "B" });
    await appendAudit(root, "user", "secret.inject", { names: ["A", "B"] });
    const entries = await readAudit(root);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.op).toBe("secret.set");
    expect(entries[2]?.detail).toEqual({ names: ["A", "B"] });
    expect(await verifyAuditChain(root)).toBe(true);
  });

  it("links each entry to the previous hash", async () => {
    const a = await appendAudit(root, "user", "x", {});
    const b = await appendAudit(root, "user", "y", {});
    expect(b.prevHash).toBe(a.hash);
  });

  // C2: appendAuditAt is a read-modify-write (read last hash -> append linked to
  // it). Fired concurrently WITHOUT serialization, several calls read the same
  // prevHash and fork the chain, so verifyAuditChain fails forever. The per-log
  // mutex must serialize them: the chain verifies and every entry is kept.
  it("serializes concurrent appends so the chain stays valid (audit C2)", async () => {
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendAudit(root, "agent", "op", { i }),
      ),
    );
    expect(await verifyAuditChain(root)).toBe(true);
    expect(await readAudit(root)).toHaveLength(N);
  });

  it("detects tampering", async () => {
    await appendAudit(root, "user", "secret.set", { name: "A" });
    await appendAudit(root, "user", "secret.delete", { name: "A" });
    const file = path.join(root, ".airlock", "audit", "log.jsonl");
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    const first = lines[0];
    if (!first) throw new Error("fixture broken");
    lines[0] = first.replace("secret.set", "secret.del");
    await writeFile(file, `${lines.join("\n")}\n`);
    expect(await verifyAuditChain(root)).toBe(false);
  });

  it("treats a corrupt line as invalid without throwing", async () => {
    await appendAudit(root, "user", "secret.set", { name: "A" });
    await appendAudit(root, "user", "secret.set", { name: "B" });
    const file = path.join(root, ".airlock", "audit", "log.jsonl");
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    // Corrupt line 1 into syntactically INVALID JSON (truncated object).
    lines[0] = '{"ts":';
    await writeFile(file, `${lines.join("\n")}\n`);
    // The chain is invalid, but neither verify nor read throws.
    expect(await verifyAuditChain(root)).toBe(false);
    const entries = await readAudit(root);
    // Best-effort read drops the corrupt line and keeps the parseable one.
    expect(entries).toHaveLength(1);
    expect(entries[0]?.detail).toEqual({ name: "B" });
  });

  it("reads an empty log as no entries with a valid chain", async () => {
    expect(await readAudit(root)).toEqual([]);
    expect(await verifyAuditChain(root)).toBe(true);
  });

  it("limits reads from the tail", async () => {
    for (let i = 0; i < 5; i++) await appendAudit(root, "user", `op${i}`, {});
    const tail = await readAudit(root, 2);
    expect(tail.map((e) => e.op)).toEqual(["op3", "op4"]);
  });

  it("appends a hash-chained entry at an explicit file path", async () => {
    // appendAuditAt takes the log file directly (no .airlock/audit derivation),
    // mkdir -p's its parent, and writes a parseable JSONL entry.
    const logFile = path.join(root, "nested", "global.jsonl");
    const a = await appendAuditAt(logFile, "user", "x.y", { a: 1 });
    const text = await readFile(logFile, "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "") as AuditEntry;
    expect(parsed.op).toBe("x.y");
    expect(parsed.detail).toEqual({ a: 1 });
    expect(parsed.hash).toBe(a.hash);
    // A second call links prevHash to the first entry's hash.
    const b = await appendAuditAt(logFile, "user", "x.z", { a: 2 });
    expect(b.prevHash).toBe(a.hash);
  });
});
