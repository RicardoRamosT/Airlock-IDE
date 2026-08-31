import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readAudit } from "../audit/audit";
import { setSecret } from "../broker/broker";
import type { KeychainStore } from "../broker/keychain";
import { removeMeta } from "../broker/meta";
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
    set: async (s, a, v) => void store.set(`${s}|${a}`, v),
    get: async (s, a) => store.get(`${s}|${a}`) ?? null,
    delete: async (s, a) => store.delete(`${s}|${a}`),
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
    expect(entry?.detail.bytes).toBe("postgres://secret-value".length);
    const line = JSON.stringify(entries);
    expect(line).toContain("secret.capture");
    expect(line).toContain("PROD_URL");
    expect(line).not.toContain("secret-value");
  });

  // runCommand's command.run audit records `blocked` (dangerous env names
  // dropped from injection); secret.capture omitted it, so a captureSecret call
  // that silently dropped e.g. PATH from injectSecrets left no forensic trace.
  // Same seeding trick as run.test.ts's equivalent case: PATH can never be
  // vaulted via setSecret (the reserved-name guard), so seed the vault blob
  // directly to exercise the inject-time dangerous-name filter.
  it("records blocked dangerous env names in the secret.capture audit, same as run_command", async () => {
    const { projectIdFor } = await import("../project/id");
    const id = await projectIdFor(root);
    store.set(`airlock|@vault/${id}`, JSON.stringify({ PATH: "/evil/bin" }));
    await captureSecret(root, "az show", "PROD_URL", {
      keychain: fake,
      runner: makeRunner({ stdout: "v" }),
      injectSecrets: ["PATH"],
    });
    const entries = await readAudit(root);
    const entry = entries.find((e) => e.op === "secret.capture");
    expect(entry?.detail.blocked).toEqual(["PATH"]);
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
    let ran = false;
    const r = await captureSecret(root, "echo x", "PATH", {
      keychain: fake,
      runner: {
        run: () => {
          ran = true;
          return Promise.resolve({
            stdout: "/tmp",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            truncated: false,
          });
        },
      },
    });
    expect(r.captured).toBe(false);
    expect(r.reason).toMatch(/dangerous/);
    expect(ran).toBe(false);
  });

  it("refuses a name that is already vaulted, before running", async () => {
    await setSecret(root, "DATABASE_URL", "postgres://dev", { keychain: fake });
    // Strip the meta entry (secrets.json) but leave the vault blob (the fake
    // keychain's backing store) untouched, so this can only pass via
    // getSecretValue -- a readMeta/listSecrets-based check would see no meta
    // entry and wrongly conclude the name is free, exactly the reserved-name-
    // seeded-straight-into-the-keychain case the guard is meant to catch.
    await removeMeta(root, "DATABASE_URL");
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

  // exitCode: 0 (not null/nonzero) so this can only pass via the `res.timedOut ||`
  // half of the failure guard -- a null/nonzero exitCode would also satisfy
  // `res.exitCode !== 0` and pass even if that check were dropped entirely.
  it("stores nothing when the command times out", async () => {
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ stdout: "abc", timedOut: true, exitCode: 0 }),
    });
    expect(r.captured).toBe(false);
    expect(r.timedOut).toBe(true);
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
    // Pin the throw to appendAudit specifically: ran=true proves the runner
    // completed (so the guards passed and the command actually ran) before the
    // rejection happened, ruling out some earlier call throwing instead.
    let ran = false;
    await expect(
      captureSecret(root, "az show", "TOKEN", {
        keychain: fake,
        runner: {
          run: () => {
            ran = true;
            return Promise.resolve({
              stdout: "value",
              stderr: "",
              exitCode: 0,
              timedOut: false,
              truncated: false,
            });
          },
        },
      }),
    ).rejects.toThrow();
    expect(ran).toBe(true);
    expect(getSessionSecretValue(root, "TOKEN")).toBeNull();
  });

  it("audits secret.capture.failed on a post-run refusal (empty output)", async () => {
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ stdout: "   \n" }),
    });
    expect(r.captured).toBe(false);
    const entries = await readAudit(root);
    const entry = entries.find((e) => e.op === "secret.capture.failed");
    expect(entry).toBeDefined();
    expect(entry?.actor).toBe("agent");
    expect(entry?.detail.reason).toMatch(/no output/);
  });

  it("redacts a vaulted secret out of the returned stderr", async () => {
    await setSecret(root, "OTHER", "sup3rsecretvalue", { keychain: fake });
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({
        exitCode: 1,
        stderr: "auth failed for account sup3rsecretvalue",
      }),
    });
    expect(r.captured).toBe(false);
    expect(r.stderr).not.toContain("sup3rsecretvalue");
  });

  it("caps the returned stderr and does not leak a secret placed beyond the cap", async () => {
    await setSecret(root, "OTHER", "sup3rsecretvalue", { keychain: fake });
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({
        exitCode: 1,
        stderr: `${"A".repeat(4096)}sup3rsecretvalue`,
      }),
    });
    expect(r.captured).toBe(false);
    expect(r.stderr?.length).toBeLessThanOrEqual(2048);
    expect(r.stderr).not.toContain("sup3rsecretvalue");
  });

  // The two tests above do not actually pin redact-before-cap: a secret placed
  // entirely past the 2048-byte cap is removed by slicing either way (verified
  // by hand-computing both compositions against the real redactSecrets before
  // writing this). Only a secret STRADDLING the cap boundary exposes a
  // cap-then-redact bug: slicing first would cut it into an unredactable
  // partial prefix, since exact-match redaction needs the whole value. This
  // test pins the actual ordering the "redact first, cap second" comment in
  // capture.ts promises.
  it("redacts a secret straddling the cap boundary rather than leaving a partial prefix", async () => {
    await setSecret(root, "OTHER", "sup3rsecretvalue", { keychain: fake });
    // "sup3rsecretvalue" is 16 chars; starting at 2040 makes it span [2040, 2056),
    // straddling the 2048 cap.
    const stderr = `${"A".repeat(2040)}sup3rsecretvalue`;
    const r = await captureSecret(root, "az show", "TOKEN", {
      keychain: fake,
      runner: makeRunner({ exitCode: 1, stderr }),
    });
    expect(r.captured).toBe(false);
    // Deterministic under redact-then-cap: the whole secret is masked to "***"
    // before the 2048 cut, and 2040 + 3 = 2043 fits under the cap untouched.
    expect(r.stderr).toBe(`${"A".repeat(2040)}***`);
    // A cap-then-redact bug would instead cut the secret mid-string, leaving
    // its first 8 bytes ("sup3rsec") sitting in the output -- too short for
    // exact-match redaction (which needs the full 16-byte value) to catch.
    expect(r.stderr).not.toContain("sup3rsec");
  });
});
