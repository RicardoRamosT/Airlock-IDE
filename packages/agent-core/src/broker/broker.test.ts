import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readAudit } from "../audit/audit";
import {
  deleteSecret,
  importDotEnv,
  injectInto,
  listSecrets,
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
});
