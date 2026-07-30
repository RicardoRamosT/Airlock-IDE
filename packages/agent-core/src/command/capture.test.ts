import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readAudit } from "../audit/audit";
import { setSecret } from "../broker/broker";
import type { KeychainStore } from "../broker/keychain";
import {
  clearSessionSecrets,
  getSessionSecretValue,
  listSessionSecretNames,
} from "../broker/session";
import { captureSecret } from "./capture";
import type { CommandRunner, CommandRunResult } from "./run";

let root: string;
let store: Map<string, string>;
let fake: KeychainStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-capture-"));
  store = new Map();
  fake = {
    set: (s, a, v) => void store.set(`${s}|${a}`, v),
    get: (s, a) => store.get(`${s}|${a}`) ?? null,
    delete: (s, a) => store.delete(`${s}|${a}`),
  };
  clearSessionSecrets();
});

function makeRunner(result: Partial<CommandRunResult> = {}): CommandRunner {
  return {
    run: () =>
      Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        truncated: false,
        ...result,
      }),
  };
}

describe("captureSecret", () => {
  it("stores trimmed stdout in the session store and returns NO output", async () => {
    const r = await captureSecret(root, "az show", "PROD_URL", {
      keychain: fake,
      runner: makeRunner({ stdout: "postgres://secret-value\n" }),
    });
    expect(r.captured).toBe(true);
    expect(r.name).toBe("PROD_URL");
    expect(r.bytes).toBe("postgres://secret-value".length);
    expect(getSessionSecretValue(root, "PROD_URL")).toBe(
      "postgres://secret-value",
    );
    // The load-bearing assertion: the value is nowhere in the result.
    expect(JSON.stringify(r)).not.toContain("secret-value");
  });

  it("audits name and bytes but never the value", async () => {
    await captureSecret(root, "az show", "PROD_URL", {
      keychain: fake,
      runner: makeRunner({ stdout: "postgres://secret-value" }),
    });
    const entries = await readAudit(root);
    const entry = entries.find((e) => e.op === "secret.capture");
    expect(entry?.actor).toBe("agent");
    const line = JSON.stringify(entries);
    expect(line).toContain("secret.capture");
    expect(line).toContain("PROD_URL");
    expect(line).not.toContain("secret-value");
  });

  it("records the fetching command in the session metadata", async () => {
    await captureSecret(root, "az containerapp show -o tsv", "PROD_URL", {
      keychain: fake,
      runner: makeRunner({ stdout: "v" }),
    });
    expect(listSessionSecretNames(root)[0]?.command).toBe(
      "az containerapp show -o tsv",
    );
  });

  it("never writes the captured value to the keychain", async () => {
    await captureSecret(root, "az show", "PROD_URL", {
      keychain: fake,
      runner: makeRunner({ stdout: "postgres://secret-value" }),
    });
    expect(store.size).toBe(0);
  });

  it("refuses an invalid secret name without running anything", async () => {
    let ran = false;
    const r = await captureSecret(root, "az show", "not a name", {
      keychain: fake,
      runner: {
        run: () => {
          ran = true;
          return Promise.resolve({
            stdout: "v",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            truncated: false,
          });
        },
      },
    });
    expect(r.captured).toBe(false);
    expect(r.reason).toMatch(/invalid secret name/);
    expect(ran).toBe(false);
  });

  it("refuses a dangerous env name", async () => {
    const r = await captureSecret(root, "echo x", "PATH", {
      keychain: fake,
      runner: makeRunner({ stdout: "/tmp" }),
    });
    expect(r.captured).toBe(false);
    expect(r.reason).toMatch(/dangerous/);
  });

  it("refuses a name that is already vaulted, before running", async () => {
    await setSecret(root, "DATABASE_URL", "postgres://dev", { keychain: fake });
    let ran = false;
    const r = await captureSecret(root, "az show", "DATABASE_URL", {
      keychain: fake,
      runner: {
        run: () => {
          ran = true;
          return Promise.resolve({
            stdout: "postgres://prod",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            truncated: false,
          });
        },
      },
    });
    expect(r.captured).toBe(false);
    expect(r.reason).toMatch(/already vaulted: DATABASE_URL/);
    expect(ran).toBe(false);
    expect(getSessionSecretValue(root, "DATABASE_URL")).toBeNull();
  });

  it("allows re-capturing a name held ONLY in the session store", async () => {
    await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ stdout: "first" }),
    });
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ stdout: "second" }),
    });
    expect(r.captured).toBe(true);
    expect(getSessionSecretValue(root, "TOKEN")).toBe("second");
  });

  it("stores nothing when the command fails, and returns redacted stderr", async () => {
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ exitCode: 1, stderr: "ERROR: not found" }),
    });
    expect(r.captured).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not found");
    expect(getSessionSecretValue(root, "TOKEN")).toBeNull();
  });

  it("stores nothing when stdout is empty or whitespace", async () => {
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ stdout: "   \n" }),
    });
    expect(r.captured).toBe(false);
    expect(r.reason).toMatch(/no output/);
    expect(getSessionSecretValue(root, "TOKEN")).toBeNull();
  });

  it("refuses a truncated capture rather than storing a partial secret", async () => {
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ stdout: "abc", truncated: true }),
    });
    expect(r.captured).toBe(false);
    expect(r.reason).toMatch(/truncated/);
    expect(getSessionSecretValue(root, "TOKEN")).toBeNull();
  });

  it("refuses a value over the size cap", async () => {
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ stdout: "x".repeat(9000) }),
    });
    expect(r.captured).toBe(false);
    expect(r.reason).toMatch(/too large/);
    expect(getSessionSecretValue(root, "TOKEN")).toBeNull();
  });

  it("stores nothing when the command times out", async () => {
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ stdout: "abc", timedOut: true, exitCode: null }),
    });
    expect(r.captured).toBe(false);
    expect(getSessionSecretValue(root, "TOKEN")).toBeNull();
  });

  // Carried-forward finding (Task 4 review): putSessionSecret used to run
  // BEFORE appendAudit, so a throwing audit write would leave a stored-but-
  // unaudited secret behind. Resolved by writing the audit entry first, so a
  // failed audit write leaves NOTHING retrievable. Force appendAudit to throw
  // via a real fs failure (a file sitting where .airlock/ needs to be a
  // directory), matching this codebase's convention of exercising real
  // failure modes over mocking modules.
  it("leaves nothing retrievable when the audit append fails", async () => {
    await writeFile(path.join(root, ".airlock"), "blocking file, not a dir");
    await expect(
      captureSecret(root, "az show", "TOKEN", {
        keychain: fake,
        runner: makeRunner({ stdout: "value" }),
      }),
    ).rejects.toThrow();
    expect(getSessionSecretValue(root, "TOKEN")).toBeNull();
  });
});
