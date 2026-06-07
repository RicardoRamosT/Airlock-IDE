import { describe, expect, it } from "vitest";
import {
  type ClaudeRunner,
  registerMcpServer,
  unregisterMcpServer,
} from "./register";

describe("registerMcpServer", () => {
  it("runs `claude mcp add` at user scope by default", async () => {
    let captured: { args: string[]; cwd: string } | null = null;
    const run: ClaudeRunner = async (args, cwd) => {
      captured = { args, cwd };
      return "";
    };
    const res = await registerMcpServer(
      { url: "http://127.0.0.1:4319/mcp", token: "T", cwd: "/c" },
      run,
    );
    expect(captured).toEqual({
      cwd: "/c",
      args: [
        "mcp",
        "add",
        "--transport",
        "http",
        "airlock",
        "http://127.0.0.1:4319/mcp",
        "--scope",
        "user",
        "--header",
        "Authorization: Bearer T",
      ],
    });
    expect(res).toEqual({ ok: true });
  });

  it("supports local scope keyed to a project dir", async () => {
    let captured: { args: string[]; cwd: string } | null = null;
    const run: ClaudeRunner = async (args, cwd) => {
      captured = { args, cwd };
      return "";
    };
    await registerMcpServer(
      {
        url: "http://127.0.0.1:4319/mcp",
        token: "T",
        scope: "local",
        cwd: "/p",
      },
      run,
    );
    expect(captured).toEqual({
      cwd: "/p",
      args: [
        "mcp",
        "add",
        "--transport",
        "http",
        "airlock",
        "http://127.0.0.1:4319/mcp",
        "--scope",
        "local",
        "--header",
        "Authorization: Bearer T",
      ],
    });
  });

  it("treats an already-registered server as success", async () => {
    const run: ClaudeRunner = async () => {
      throw new Error("MCP server airlock already exists");
    };
    expect(
      await registerMcpServer(
        { url: "http://127.0.0.1:4319/mcp", token: "T" },
        run,
      ),
    ).toEqual({ ok: true, alreadyExists: true });
  });

  it("returns not_found when the claude CLI is absent (ENOENT)", async () => {
    const run: ClaudeRunner = async () => {
      throw { code: "ENOENT" };
    };
    expect(
      await registerMcpServer(
        { url: "http://127.0.0.1:4319/mcp", token: "T" },
        run,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("scrubs the bearer token out of surfaced error messages", async () => {
    const run: ClaudeRunner = async () => {
      throw new Error("boom T");
    };
    const res = await registerMcpServer(
      { url: "http://127.0.0.1:4319/mcp", token: "T" },
      run,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.reason).toBe("error");
    expect(res.message).toBeDefined();
    expect(res.message).not.toContain("T");
    expect(res.message).toContain("***");
  });
});

describe("unregisterMcpServer", () => {
  it("runs `claude mcp remove` at user scope by default", async () => {
    let captured: { args: string[]; cwd: string } | null = null;
    const run: ClaudeRunner = async (args, cwd) => {
      captured = { args, cwd };
      return "";
    };
    const res = await unregisterMcpServer({ cwd: "/c" }, run);
    expect(captured).toEqual({
      cwd: "/c",
      args: ["mcp", "remove", "airlock", "--scope", "user"],
    });
    expect(res).toEqual({ ok: true });
  });

  it("treats a missing server as success (idempotent teardown)", async () => {
    const run: ClaudeRunner = async () => {
      throw new Error("No MCP server found with name airlock");
    };
    expect(await unregisterMcpServer({}, run)).toEqual({ ok: true });
  });

  it("returns not_found when the claude CLI is absent (ENOENT)", async () => {
    const run: ClaudeRunner = async () => {
      throw { code: "ENOENT" };
    };
    expect(await unregisterMcpServer({}, run)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
