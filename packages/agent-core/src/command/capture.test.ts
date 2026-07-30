import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readAudit } from "../audit/audit";
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
});
