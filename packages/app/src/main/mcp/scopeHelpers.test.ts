import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  projectTokenFrom,
  renderClaudeShim,
  renderMcpConfigJson,
  sessionsForRoot,
  shimShouldInject,
} from "./scopeHelpers";

describe("shimShouldInject", () => {
  it("injects for a session launch", () => {
    expect(shimShouldInject([])).toBe(true); // bare `claude`
    expect(shimShouldInject(["-p", "hi"])).toBe(true);
    expect(shimShouldInject(["--continue"])).toBe(true);
    expect(shimShouldInject(["--resume", "abc"])).toBe(true);
    expect(shimShouldInject(["--model", "sonnet"])).toBe(true);
  });
  it("passes through management invocations", () => {
    expect(shimShouldInject(["mcp", "add", "x"])).toBe(false);
    expect(shimShouldInject(["config", "get", "y"])).toBe(false);
    expect(shimShouldInject(["doctor"])).toBe(false);
    expect(shimShouldInject(["--version"])).toBe(false);
    expect(shimShouldInject(["-h"])).toBe(false);
  });
});

describe("projectTokenFrom", () => {
  it("is deterministic, 32-hex, and salt+id dependent", () => {
    const t = projectTokenFrom("salt", "proj-12345678");
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(projectTokenFrom("salt", "proj-12345678")).toBe(t);
    expect(projectTokenFrom("salt2", "proj-12345678")).not.toBe(t);
    expect(projectTokenFrom("salt", "other-87654321")).not.toBe(t);
    // matches the documented derivation
    expect(t).toBe(
      createHmac("sha256", "salt")
        .update("proj-12345678")
        .digest("hex")
        .slice(0, 32),
    );
  });
});

describe("renderMcpConfigJson", () => {
  it("emits a parseable http server with path token + bearer", () => {
    const json = renderMcpConfigJson({
      port: 5123,
      projectToken: "tok",
      accessToken: "acc",
    });
    const o = JSON.parse(json);
    expect(o.mcpServers.airlock.type).toBe("http");
    expect(o.mcpServers.airlock.url).toBe("http://127.0.0.1:5123/mcp/tok");
    expect(o.mcpServers.airlock.headers.Authorization).toBe("Bearer acc");
  });
});

describe("renderClaudeShim", () => {
  it("bakes paths and the subcommand case, starts with a sh shebang", () => {
    const sh = renderClaudeShim({
      selfDir: "/d/bin",
      mcpConfigPath: "/d/mcp.json",
      realClaudeAbs: "/usr/local/bin/claude",
    });
    expect(sh.startsWith("#!/bin/sh")).toBe(true);
    expect(sh).toContain("/d/mcp.json");
    expect(sh).toContain("/d/bin");
    expect(sh).toContain("mcp|config|doctor"); // subcommand case present
    expect(sh).toContain("--mcp-config");
  });
});

describe("sessionsForRoot", () => {
  it("returns only sessions matching the root; empty for null", () => {
    const m = new Map([
      ["a", "/p1"],
      ["b", "/p2"],
      ["c", "/p1"],
    ]);
    expect(sessionsForRoot(m, "/p1").sort()).toEqual(["a", "c"]);
    expect(sessionsForRoot(m, "/none")).toEqual([]);
    expect(sessionsForRoot(m, null)).toEqual([]);
  });
});
