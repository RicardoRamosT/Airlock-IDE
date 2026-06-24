import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readAudit } from "../audit/audit";
import { setSecret } from "../broker/broker";
import type { KeychainStore } from "../broker/keychain";
import { type CommandRunner, type CommandRunResult, runCommand } from "./run";

let root: string;
let store: Map<string, string>;
let fake: KeychainStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-command-"));
  store = new Map();
  fake = {
    set: (s, a, v) => void store.set(`${s}|${a}`, v),
    get: (s, a) => store.get(`${s}|${a}`) ?? null,
    delete: (s, a) => store.delete(`${s}|${a}`),
  };
});

// A fake runner that records the options it was handed (so we can assert on the
// injected env + cwd) and returns a scripted result. Defaults to an empty,
// successful run so each test only overrides what it cares about.
interface FakeRunner extends CommandRunner {
  calls: {
    command: string;
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    maxBytes: number;
  }[];
}

function makeRunner(result: Partial<CommandRunResult> = {}): FakeRunner {
  const calls: FakeRunner["calls"] = [];
  return {
    calls,
    run(command, opts) {
      calls.push({ command, ...opts });
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        truncated: false,
        ...result,
      });
    },
  };
}

describe("runCommand", () => {
  it("injects a vaulted secret into the child env and uses the root as cwd", async () => {
    await setSecret(root, "DATABASE_URL", "postgresql://u:hunter2@h/db", {
      keychain: fake,
    });
    const runner = makeRunner();
    await runCommand(root, "echo hi", {
      injectSecrets: ["DATABASE_URL"],
      keychain: fake,
      runner,
    });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.env.DATABASE_URL).toBe(
      "postgresql://u:hunter2@h/db",
    );
    expect(runner.calls[0]?.cwd).toBe(root);
  });

  it("resolves an in-root subdirectory cwd and uses it", async () => {
    const runner = makeRunner();
    const sub = path.join(root, "packages", "app");
    await runCommand(root, "echo hi", { cwd: sub, keychain: fake, runner });
    expect(runner.calls[0]?.cwd).toBe(sub);
  });

  // C3 / M1: cwd is agent-controlled and is NOT inspected by the command-policy
  // classifier. A cwd outside the workspace lets an innocent command (e.g.
  // "cat .env") run in another project and read its files -- and the per-project
  // redactor would not mask that project's secrets. Fail closed: reject, never
  // run, audit blocked with the cwd.
  it("rejects (fail-closed) a cwd outside the workspace", async () => {
    const runner = makeRunner();
    await expect(
      runCommand(root, "cat .env", {
        cwd: "/tmp/other-project",
        keychain: fake,
        runner,
      }),
    ).rejects.toThrow(/outside the workspace/i);
    expect(runner.calls).toHaveLength(0);
    const blocked = (await readAudit(root)).find(
      (e) => e.op === "command.run.blocked",
    );
    expect(blocked).toBeDefined();
    expect(JSON.stringify(blocked?.detail)).toContain("cwd");
  });

  it("rejects a relative cwd that escapes the root via ..", async () => {
    const runner = makeRunner();
    await expect(
      runCommand(root, "ls", { cwd: "../..", keychain: fake, runner }),
    ).rejects.toThrow(/outside the workspace/i);
    expect(runner.calls).toHaveLength(0);
  });

  // THE REDACTION GUARD: a command that echoes an injected secret value MUST
  // come back redacted. This is the security proof of the whole feature.
  it("redacts every occurrence of an injected secret from the output", async () => {
    const value = "postgresql://u:hunter2@h/db";
    await setSecret(root, "DATABASE_URL", value, { keychain: fake });
    const runner = makeRunner({
      stdout: `connecting to ${value} ok\nretry connecting to ${value} ok`,
    });
    const res = await runCommand(root, "psql", {
      injectSecrets: ["DATABASE_URL"],
      keychain: fake,
      runner,
    });
    expect(res.output).toContain("***");
    expect(res.output).not.toContain(value);
    expect(res.output).not.toContain("hunter2");
    expect(res.exitCode).toBe(0);
  });

  // C1/H1: redaction must cover EVERY vaulted secret, not just the injected
  // subset -- a vaulted value can surface via the inherited env on a command
  // that injects nothing.
  it("redacts a vaulted secret that was NOT injected", async () => {
    await setSecret(root, "OTHER_SECRET", "sekret-not-injected-xyz", {
      keychain: fake,
    });
    const runner = makeRunner({
      stdout: "leaked sekret-not-injected-xyz here",
    });
    const res = await runCommand(root, "printenv", { keychain: fake, runner });
    expect(res.output).not.toContain("sekret-not-injected-xyz");
    expect(res.output).toContain("***");
  });

  it("fails closed when a requested secret is not vaulted: throws the name, never runs, audits blocked", async () => {
    const runner = makeRunner();
    await expect(
      runCommand(root, "echo hi", {
        injectSecrets: ["MISSING"],
        keychain: fake,
        runner,
      }),
    ).rejects.toThrow(/MISSING/);
    // The runner must NEVER be invoked when a requested secret is absent.
    expect(runner.calls).toHaveLength(0);
    const blocked = (await readAudit(root)).find(
      (e) => e.op === "command.run.blocked",
    );
    expect(blocked).toBeDefined();
    expect(JSON.stringify(blocked?.detail)).toContain("MISSING");
  });

  it("the fail-closed error message carries the name only, never a value", async () => {
    const runner = makeRunner();
    let message = "";
    try {
      await runCommand(root, "echo hi", {
        injectSecrets: ["MISSING"],
        keychain: fake,
        runner,
      });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("MISSING");
    // No value can leak: MISSING was never vaulted, so any value substring would
    // be a bug. Assert the message is name-scoped (no "://" or password shapes).
    expect(message).not.toContain("://");
  });

  it("filters a dangerous injected name out of the env but keeps it in the redaction set", async () => {
    // PATH cannot be vaulted via setSecret (reserved-name guard), so seed the
    // project's vault blob directly (the single keychain item the broker now
    // uses) with a no-meta PATH entry, to exercise the inject-time
    // dangerous-name filter in isolation.
    const { projectIdFor } = await import("../project/id");
    const id = await projectIdFor(root);
    store.set(`airlock|@vault/${id}`, JSON.stringify({ PATH: "/evil/bin" }));
    const runner = makeRunner({ stdout: "resolved /evil/bin here" });
    const res = await runCommand(root, "echo $PATH", {
      injectSecrets: ["PATH"],
      keychain: fake,
      runner,
    });
    // The dangerous secret value must NOT be injected into the child env...
    expect(runner.calls[0]?.env.PATH).not.toBe("/evil/bin");
    // ...but it MUST still be redacted out of the output if echoed.
    expect(res.output).not.toContain("/evil/bin");
    expect(res.output).toContain("***");
    // The audit blocked list names it.
    const run = (await readAudit(root)).find((e) => e.op === "command.run");
    expect(run?.detail.blocked).toEqual(["PATH"]);
  });

  it("passes exitCode, timedOut, and truncated through from the runner", async () => {
    const runner = makeRunner({
      exitCode: 3,
      timedOut: true,
      truncated: true,
    });
    const res = await runCommand(root, "sleep 100", {
      keychain: fake,
      runner,
    });
    expect(res.exitCode).toBe(3);
    expect(res.timedOut).toBe(true);
    expect(res.truncated).toBe(true);
  });

  it("appends a command.run audit with command + names and no secret value anywhere", async () => {
    const value = "postgresql://u:hunter2@h/db";
    await setSecret(root, "DATABASE_URL", value, { keychain: fake });
    const runner = makeRunner({ stdout: `using ${value}` });
    await runCommand(root, "psql --version", {
      injectSecrets: ["DATABASE_URL"],
      keychain: fake,
      runner,
    });
    const run = (await readAudit(root)).find((e) => e.op === "command.run");
    expect(run).toBeDefined();
    expect(run?.detail.command).toBe("psql --version");
    expect(run?.detail.names).toEqual(["DATABASE_URL"]);
    // The entire audit entry must be free of the secret value.
    expect(JSON.stringify(run)).not.toContain("hunter2");
    expect(JSON.stringify(run)).not.toContain(value);
  });

  it("combines stderr after stdout in the redacted output", async () => {
    const runner = makeRunner({ stdout: "out line", stderr: "err line" });
    const res = await runCommand(root, "echo hi", {
      keychain: fake,
      runner,
    });
    expect(res.output).toBe("out line\nerr line");
  });
});
