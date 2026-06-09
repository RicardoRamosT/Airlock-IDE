import { describe, expect, it } from "vitest";
import { filterDangerousEnv } from "./dangerous";

describe("filterDangerousEnv", () => {
  it("strips loader-hijack and path-control names", () => {
    const { safe, blocked } = filterDangerousEnv({
      PATH: "/evil",
      DYLD_INSERT_LIBRARIES: "/evil.dylib",
      LD_PRELOAD: "/evil.so",
      NODE_OPTIONS: "--require evil",
      DATABASE_URL: "ok",
    });
    expect(safe).toEqual({ DATABASE_URL: "ok" });
    expect(blocked.sort()).toEqual([
      "DYLD_INSERT_LIBRARIES",
      "LD_PRELOAD",
      "NODE_OPTIONS",
      "PATH",
    ]);
  });

  it("blocks any DYLD_/LD_ prefixed name", () => {
    const { blocked } = filterDangerousEnv({
      DYLD_LIBRARY_PATH: "x",
      LD_AUDIT: "y",
    });
    expect(blocked.sort()).toEqual(["DYLD_LIBRARY_PATH", "LD_AUDIT"]);
  });

  it("passes ordinary names through untouched", () => {
    const env = { ANTHROPIC_API_KEY: "k", SNOWFLAKE_PASSWORD: "p" };
    expect(filterDangerousEnv(env)).toEqual({ safe: env, blocked: [] });
  });

  // C6: the set must cover the whole loader/command-hijack class, not just the
  // node/dyld subset -- each of these auto-executes code in a child process
  // (sourced startup file, git transport/diff/pager/editor hook, or interpreter
  // auto-load), so a vaulted secret with the name would hijack every command.
  it("strips shell-startup, git-hook, and interpreter-loader names (audit C6)", () => {
    const names = [
      "BASH_ENV",
      "ENV",
      "PROMPT_COMMAND",
      "ZDOTDIR",
      "GIT_SSH_COMMAND",
      "GIT_SSH",
      "GIT_EXTERNAL_DIFF",
      "GIT_PAGER",
      "GIT_EDITOR",
      "PAGER",
      "EDITOR",
      "VISUAL",
      "PERL5OPT",
      "PERL5LIB",
      "PYTHONSTARTUP",
      "PYTHONPATH",
      "RUBYOPT",
      "RUBYLIB",
    ];
    const env = Object.fromEntries([
      ...names.map((n) => [n, "x"]),
      ["KEEP", "y"],
    ]);
    const { safe, blocked } = filterDangerousEnv(env);
    expect(blocked.sort()).toEqual([...names].sort());
    expect(safe).toEqual({ KEEP: "y" });
  });

  it("blocks exported bash functions (BASH_FUNC_ prefix / Shellshock)", () => {
    const { safe, blocked } = filterDangerousEnv({
      "BASH_FUNC_ls%%": "() { evil; }",
      BASH_FUNC_x: "() { :; }",
      KEEP: "ok",
    });
    expect(blocked.sort()).toEqual(["BASH_FUNC_ls%%", "BASH_FUNC_x"]);
    expect(safe).toEqual({ KEEP: "ok" });
  });
});
