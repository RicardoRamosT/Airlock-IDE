import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readAudit } from "../audit/audit";
import {
  deleteGlobalSecret,
  deleteSecret,
  getGlobalSecret,
  getSecretValue,
  importAllDotEnv,
  importDotEnv,
  injectInto,
  listSecrets,
  setGlobalSecret,
  setSecret,
} from "./broker";
import type { KeychainStore } from "./keychain";

let root: string;
let store: Map<string, string>;
let fake: KeychainStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-broker-"));
  store = new Map();
  fake = {
    set: (s, a, v) => void store.set(`${s}|${a}`, v),
    get: (s, a) => store.get(`${s}|${a}`) ?? null,
    delete: (s, a) => store.delete(`${s}|${a}`),
  };
});

describe("broker", () => {
  it("stores a secret in the keychain, never in the meta file", async () => {
    const meta = await setSecret(
      root,
      "DATABASE_URL",
      "postgresql://u:hunter2@h/db",
      {
        keychain: fake,
      },
    );
    expect(meta.provider).toBe("postgres-url");
    expect(meta.valid).toBe(true);
    expect([...store.values()]).toContain("postgresql://u:hunter2@h/db");
    const metaText = await readFile(
      path.join(root, ".airlock", "secrets.json"),
      "utf8",
    );
    expect(metaText).not.toContain("hunter2");
  });

  it("rejects invalid names", async () => {
    await expect(
      setSecret(root, "BAD NAME", "v", { keychain: fake }),
    ).rejects.toThrow(/invalid secret name/i);
  });

  // L7: an empty/whitespace-only value is meaningless and, worse, UNREDACTABLE
  // (the redactor skips whitespace-only values), so it must be rejected, not
  // vaulted. validateSecret is advisory and never gated this.
  it("rejects an empty or whitespace-only secret value (L7)", async () => {
    await expect(
      setSecret(root, "EMPTY", "", { keychain: fake }),
    ).rejects.toThrow(/empty/i);
    await expect(
      setSecret(root, "BLANK", "   ", { keychain: fake }),
    ).rejects.toThrow(/empty/i);
    // nothing was vaulted
    expect(await listSecrets(root)).toEqual([]);
    expect(store.size).toBe(0);
  });

  it("lists metadata only and deletes everywhere", async () => {
    await setSecret(root, "A", "value-a", { keychain: fake });
    await setSecret(root, "B", "value-b", { keychain: fake });
    const list = await listSecrets(root);
    expect(list.map((m) => m.name)).toEqual(["A", "B"]);
    await deleteSecret(root, "A", { keychain: fake });
    expect((await listSecrets(root)).map((m) => m.name)).toEqual(["B"]);
    expect(store.size).toBe(1);
  });

  it("injects stored values over a base env", async () => {
    await setSecret(root, "FOO", "secret-foo", { keychain: fake });
    await setSecret(root, "BAR", "secret-bar", { keychain: fake });
    const r = await injectInto(
      root,
      { PATH: "/bin", FOO: "overridden" },
      { keychain: fake },
    );
    expect(r.env).toEqual({
      PATH: "/bin",
      FOO: "secret-foo",
      BAR: "secret-bar",
    });
    expect(r.injected.sort()).toEqual(["BAR", "FOO"]);
  });

  it("skips keychain-missing values on inject without failing", async () => {
    await setSecret(root, "GONE", "x", { keychain: fake });
    store.clear();
    const r = await injectInto(root, {}, { keychain: fake });
    expect(r.env).toEqual({});
    expect(r.missing).toEqual(["GONE"]);
  });

  it("imports a .env file and can delete it after", async () => {
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "A=1\nB=2\n# c\n1BAD=x\n");
    const result = await importDotEnv(root, ".env", {
      keychain: fake,
      deleteAfter: true,
    });
    expect(result.imported.map((m) => m.name)).toEqual(["A", "B"]);
    expect(result.skipped).toEqual([]);
    expect(result.deleted).toBe(true);
    await expect(stat(envPath)).rejects.toThrow();
  });

  it("audits set, delete, inject, and import operations", async () => {
    await setSecret(root, "A", "1", { keychain: fake });
    await deleteSecret(root, "A", { keychain: fake });
    await injectInto(root, {}, { keychain: fake });
    const ops = (await readAudit(root)).map((e) => e.op);
    expect(ops).toEqual(["secret.set", "secret.delete", "secret.inject"]);
  });

  it("preserves the file when deleteAfter is set but entries were skipped", async () => {
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "GOOD=value\nEMPTY=\n");
    const result = await importDotEnv(root, ".env", {
      keychain: fake,
      deleteAfter: true,
    });
    expect(result.imported.map((m) => m.name)).toEqual(["GOOD"]);
    expect(result.skipped).toEqual(["EMPTY"]);
    expect(result.deleted).toBe(false);
    await expect(stat(envPath)).resolves.toBeDefined();
  });

  it("audits imports with the secret.import op", async () => {
    await writeFile(path.join(root, ".env"), "A=1\n");
    await importDotEnv(root, ".env", { keychain: fake });
    const ops = (await readAudit(root)).map((e) => e.op);
    expect(ops).toEqual(["secret.set", "secret.import"]);
  });

  it("preserves createdAt across updates", async () => {
    const first = await setSecret(root, "K", "v1", { keychain: fake });
    await new Promise((r) => setTimeout(r, 5));
    const second = await setSecret(root, "K", "v2", { keychain: fake });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
  });

  it("rejects reserved env names at store time", async () => {
    await expect(
      setSecret(root, "PATH", "/evil/bin", { keychain: fake }),
    ).rejects.toThrow(/reserved/i);
    await expect(
      setSecret(root, "DYLD_FOO", "x", { keychain: fake }),
    ).rejects.toThrow(/reserved/i);
    // A normal name still works and is unaffected by the reserved-name guard.
    const meta = await setSecret(root, "NORMAL_KEY", "ok", { keychain: fake });
    expect(meta.name).toBe("NORMAL_KEY");
    expect([...store.values()]).toContain("ok");
  });

  it("propagates a non-not-found keychain get error on inject", async () => {
    await setSecret(root, "LOCKED", "v", { keychain: fake });
    // A locked/access-denied keychain throws a NON-not-found error; inject must
    // surface it (reject) rather than silently treating the secret as missing.
    const lockedFake: KeychainStore = {
      ...fake,
      get: () => {
        throw new Error("Platform secure storage failure: keychain is locked");
      },
    };
    await expect(
      injectInto(root, {}, { keychain: lockedFake }),
    ).rejects.toThrow(/locked/i);
  });

  it("records failures, keeps the file, and still writes the import audit when an entry throws mid-loop", async () => {
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "A=1\nB=2\nC=3\n");
    // Keychain that throws when storing the 2nd name (B) - e.g. a locked store.
    // The loop must record B as failed and continue to C, not abort.
    const throwOnB: KeychainStore = {
      ...fake,
      set: (s, a, v) => {
        if (a.endsWith(":B"))
          throw new Error(
            "Platform secure storage failure: keychain is locked",
          );
        store.set(`${s}|${a}`, v);
      },
    };
    const result = await importDotEnv(root, ".env", {
      keychain: throwOnB,
      deleteAfter: true,
    });
    expect(result.imported.map((m) => m.name)).toEqual(["A", "C"]);
    expect(result.failed).toEqual(["B"]);
    expect(result.skipped).toEqual([]);
    // A failure blocks deletion: the .env must survive so B can be retried.
    expect(result.deleted).toBe(false);
    await expect(stat(envPath)).resolves.toBeDefined();
    // The summary audit is still written and honestly records the failure.
    const imp = (await readAudit(root)).find((e) => e.op === "secret.import");
    expect(imp?.detail).toMatchObject({
      imported: ["A", "C"],
      failed: ["B"],
      skipped: [],
      deleted: false,
    });
  });

  it("getSecretValue returns the raw value by name, null when absent", async () => {
    await setSecret(root, "A", "val", { keychain: fake });
    // The main-only by-name value path: returns the credential verbatim so
    // main can open a connection with it.
    expect(await getSecretValue(root, "A", { keychain: fake })).toBe("val");
    // Missing name -> null (no throw); mirrors keychain.get's not-found case.
    expect(
      await getSecretValue(root, "MISSING", { keychain: fake }),
    ).toBeNull();
  });

  it("records keychainDeleted:false when the OS delete reports no removal", async () => {
    await setSecret(root, "DANGLING", "v", { keychain: fake });
    // Fake whose delete reports failure (e.g. locked store): meta is still
    // removed, but the audit honestly records that the keychain kept the value.
    const failDelete: KeychainStore = { ...fake, delete: () => false };
    await deleteSecret(root, "DANGLING", { keychain: failDelete });
    expect((await listSecrets(root)).map((m) => m.name)).not.toContain(
      "DANGLING",
    );
    const del = (await readAudit(root)).find((e) => e.op === "secret.delete");
    expect(del?.detail).toMatchObject({
      name: "DANGLING",
      keychainDeleted: false,
    });
  });

  it("vaults and reads an app-global secret round-trip", async () => {
    await setGlobalSecret("NEON_API_KEY", "v", { keychain: fake });
    expect(await getGlobalSecret("NEON_API_KEY", { keychain: fake })).toBe("v");
  });

  it("returns null for an unset app-global secret", async () => {
    expect(
      await getGlobalSecret("NEON_API_KEY", { keychain: fake }),
    ).toBeNull();
  });

  it("stores app-global secrets under the @global namespace", async () => {
    await setGlobalSecret("NEON_API_KEY", "v", { keychain: fake });
    // The fake records keys as "<service>|<account>". The account must be the
    // reserved global namespace, which a project secret ("<id>:<name>") can
    // never produce, so there is no cross-project collision.
    expect([...store.keys()]).toContain("airlock|@global/NEON_API_KEY");
  });

  it("rejects an empty app-global secret value", async () => {
    await expect(
      setGlobalSecret("NEON_API_KEY", "", { keychain: fake }),
    ).rejects.toThrow(/empty/i);
  });

  it("deletes an app-global secret so it reads back null", async () => {
    await setGlobalSecret("NEON_API_KEY", "v", { keychain: fake });
    await deleteGlobalSecret("NEON_API_KEY", { keychain: fake });
    expect(
      await getGlobalSecret("NEON_API_KEY", { keychain: fake }),
    ).toBeNull();
  });

  it("audits setGlobalSecret to the app-global chain when auditLog is set", async () => {
    const auditLog = path.join(root, "global-audit.jsonl");
    await setGlobalSecret("NEON_API_KEY", "v", { keychain: fake, auditLog });
    const text = await readFile(auditLog, "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "");
    expect(entry.op).toBe("secret.global.set");
    expect(entry.detail).toEqual({ name: "NEON_API_KEY" });
    // First entry in a fresh chain links to genesis (all zeros).
    expect(entry.prevHash).toBe("0".repeat(64));
  });

  it("attributes audit entries to the agent when actor is set", async () => {
    await writeFile(path.join(root, ".env"), "A=1\n");
    await importDotEnv(root, ".env", { keychain: fake, actor: "agent" });
    const entries = await readAudit(root);
    // secret.set (from the inner setSecret) + secret.import, both as agent.
    expect(entries.map((e) => e.op)).toEqual(["secret.set", "secret.import"]);
    expect(entries.map((e) => e.actor)).toEqual(["agent", "agent"]);
  });

  it("defaults audit attribution to the user", async () => {
    await setSecret(root, "A", "1", { keychain: fake });
    expect((await readAudit(root))[0]?.actor).toBe("user");
  });
});

describe("importAllDotEnv", () => {
  it("discovers and imports every importable env file, skipping templates", async () => {
    await writeFile(path.join(root, ".env"), "A=1\n");
    await writeFile(path.join(root, ".env.local"), "B=2\n");
    await writeFile(path.join(root, ".env.example"), "TEMPLATE=placeholder\n");
    const results = await importAllDotEnv(root, { keychain: fake });
    expect(results.map((r) => r.file)).toEqual([".env", ".env.local"]);
    expect(results[0]?.result?.imported.map((m) => m.name)).toEqual(["A"]);
    expect(results[1]?.result?.imported.map((m) => m.name)).toEqual(["B"]);
    // The template never entered the vault and survived on disk.
    expect((await listSecrets(root)).map((m) => m.name).sort()).toEqual([
      "A",
      "B",
    ]);
    await expect(stat(path.join(root, ".env.example"))).resolves.toBeDefined();
  });

  it("imports in precedence order so a .local value wins duplicate keys", async () => {
    await writeFile(path.join(root, ".env"), "DUP=base\n");
    await writeFile(path.join(root, ".env.local"), "DUP=local\n");
    await importAllDotEnv(root, { keychain: fake });
    expect(await getSecretValue(root, "DUP", { keychain: fake })).toBe("local");
  });

  it("deletes only cleanly imported files when deleteAfter is set", async () => {
    await writeFile(path.join(root, ".env"), "GOOD=1\n");
    await writeFile(path.join(root, ".env.local"), "OK=1\nEMPTY=\n");
    const results = await importAllDotEnv(root, {
      keychain: fake,
      deleteAfter: true,
    });
    expect(results[0]?.result?.deleted).toBe(true);
    expect(results[1]?.result?.deleted).toBe(false);
    await expect(stat(path.join(root, ".env"))).rejects.toThrow();
    await expect(stat(path.join(root, ".env.local"))).resolves.toBeDefined();
  });

  it("ignores directories whose names look like env files", async () => {
    await mkdir(path.join(root, ".env.local"));
    await writeFile(path.join(root, ".env"), "A=1\n");
    const results = await importAllDotEnv(root, { keychain: fake });
    expect(results.map((r) => r.file)).toEqual([".env"]);
  });

  it("returns [] when no env files exist", async () => {
    expect(await importAllDotEnv(root, { keychain: fake })).toEqual([]);
  });

  it("records a per-file error and continues when an explicit file is missing", async () => {
    await writeFile(path.join(root, ".env"), "A=1\n");
    const results = await importAllDotEnv(root, {
      keychain: fake,
      files: [".env.gone", ".env"],
    });
    expect(results[0]?.file).toBe(".env.gone");
    expect(results[0]?.error).toBeTruthy();
    expect(results[0]?.result).toBeUndefined();
    expect(results[1]?.result?.imported.map((m) => m.name)).toEqual(["A"]);
  });

  it("imports exactly the explicit files, bypassing the exclusion predicate", async () => {
    await writeFile(path.join(root, ".env.example"), "FROM_TEMPLATE=v\n");
    await writeFile(path.join(root, ".env"), "IGNORED=v\n");
    const results = await importAllDotEnv(root, {
      keychain: fake,
      files: [".env.example"],
    });
    expect(results.map((r) => r.file)).toEqual([".env.example"]);
    expect((await listSecrets(root)).map((m) => m.name)).toEqual([
      "FROM_TEMPLATE",
    ]);
  });

  it("confines explicit files to the root", async () => {
    const results = await importAllDotEnv(root, {
      keychain: fake,
      files: ["../outside.env"],
    });
    expect(results[0]?.error).toBeTruthy();
    expect(results[0]?.result).toBeUndefined();
  });
});
