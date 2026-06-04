import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAudit, readAudit, verifyAuditChain } from "./audit";

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

  it("reads an empty log as no entries with a valid chain", async () => {
    expect(await readAudit(root)).toEqual([]);
    expect(await verifyAuditChain(root)).toBe(true);
  });

  it("limits reads from the tail", async () => {
    for (let i = 0; i < 5; i++) await appendAudit(root, "user", `op${i}`, {});
    const tail = await readAudit(root, 2);
    expect(tail.map((e) => e.op)).toEqual(["op3", "op4"]);
  });
});
