import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LintOutcome } from "./pool";
import { createEslintService } from "./service";

const ROOT = "/p";
let files: Set<string>;
let trusted: Set<string>;
type PoolLint = (
  unit: string,
  file: string,
  text: string,
) => Promise<LintOutcome>;
let poolLint: ReturnType<typeof vi.fn<PoolLint>>;
let disposeUnit: ReturnType<typeof vi.fn<(unit: string) => void>>;

function svc() {
  return createEslintService({
    exists: (abs) => files.has(abs),
    trust: {
      isTrusted: (d) => trusted.has(d),
      set: (d, on) => void (on ? trusted.add(d) : trusted.delete(d)),
    },
    pool: { lint: poolLint, disposeUnit },
  });
}

beforeEach(() => {
  files = new Set([
    "/p/eslint.config.js",
    "/p/node_modules/eslint/package.json",
    "/p/legacy/.eslintrc.json",
    "/p/bare/eslint.config.mjs", // config, but no ESLint installed anywhere below the root's
  ]);
  trusted = new Set();
  poolLint = vi.fn<PoolLint>(async () => ({ messages: [] }));
  disposeUnit = vi.fn<(unit: string) => void>();
});

describe("status", () => {
  it("is none for non-JS files and files with no config above them", () => {
    files.delete("/p/eslint.config.js");
    expect(svc().status(ROOT, "README.md")).toEqual({
      state: "none",
      unit: null,
    });
    expect(svc().status(ROOT, "src/a.ts")).toEqual({
      state: "none",
      unit: null,
    });
  });
  it("is untrusted until the user allows it, then trusted", () => {
    const s = svc();
    expect(s.status(ROOT, "src/a.ts")).toEqual({
      state: "untrusted",
      unit: "",
    });
    s.setTrust(ROOT, "", true);
    expect(s.status(ROOT, "src/a.ts")).toEqual({ state: "trusted", unit: "" });
  });
  it("is missing-eslint when the config's ESLint is not installed", () => {
    files.delete("/p/node_modules/eslint/package.json");
    expect(svc().status(ROOT, "bare/a.ts")).toEqual({
      state: "missing-eslint",
      unit: "bare",
    });
  });
  it("refuses a path that climbs out of the project", () => {
    expect(svc().status(ROOT, "../other/a.ts")).toEqual({
      state: "none",
      unit: null,
    });
  });
});

describe("lint", () => {
  it("REFUSES an untrusted unit and never reaches the pool", async () => {
    const r = await svc().lint(ROOT, "src/a.ts", 3, "var x");
    expect(r).toEqual({ version: 3, untrusted: true });
    expect(poolLint).not.toHaveBeenCalled();
  });
  it("lints a trusted unit through the pool, echoing the version", async () => {
    trusted.add("/p");
    const msg = {
      line: 1,
      column: 1,
      severity: 2 as const,
      ruleId: "no-var",
      message: "Unexpected var",
    };
    poolLint.mockResolvedValueOnce({ messages: [msg] });
    const r = await svc().lint(ROOT, "src/a.ts", 4, "var x");
    expect(poolLint).toHaveBeenCalledWith("/p", "/p/src/a.ts", "var x");
    expect(r).toEqual({ version: 4, messages: [msg] });
  });
  it("re-checks trust on EVERY call: revoked means refused at once", async () => {
    const s = svc();
    s.setTrust(ROOT, "", true);
    await s.lint(ROOT, "a.ts", 1, "");
    s.setTrust(ROOT, "", false);
    expect(await s.lint(ROOT, "a.ts", 2, "")).toEqual({
      version: 2,
      untrusted: true,
    });
    expect(poolLint).toHaveBeenCalledTimes(1);
  });
  it("reports a timeout as a config error and a superseded lint as superseded", async () => {
    trusted.add("/p");
    poolLint.mockResolvedValueOnce({ timedOut: true });
    expect(await svc().lint(ROOT, "a.ts", 5, "")).toEqual({
      version: 5,
      configError: "ESLint timed out",
    });
    poolLint.mockResolvedValueOnce({ superseded: true });
    expect(await svc().lint(ROOT, "a.ts", 6, "")).toEqual({
      version: 6,
      superseded: true,
    });
  });
});

describe("setTrust", () => {
  it("rejects a folder that holds no ESLint config", () => {
    expect(() => svc().setTrust(ROOT, "src", true)).toThrow(/no ESLint config/);
    expect(() => svc().setTrust(ROOT, "legacy", true)).toThrow(
      /no ESLint config/,
    );
  });
  it("rejects a folder outside the project", () => {
    expect(() => svc().setTrust(ROOT, "../other", true)).toThrow();
  });
  it("revoking disposes that unit's worker", () => {
    const s = svc();
    s.setTrust(ROOT, "", true);
    s.setTrust(ROOT, "", false);
    expect(disposeUnit).toHaveBeenCalledWith("/p");
  });
});
