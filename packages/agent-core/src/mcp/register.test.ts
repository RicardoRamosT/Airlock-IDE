import { describe, expect, it } from "vitest";
import { type ClaudeRunner, registerMcpServer } from "./register";

describe("registerMcpServer", () => {
  it("runs `claude mcp add` with local scope keyed to the project dir", async () => {
    let captured: { args: string[]; cwd: string } | null = null;
    const run: ClaudeRunner = async (args, cwd) => {
      captured = { args, cwd };
      return "";
    };
    const res = await registerMcpServer(
      { root: "/p", url: "http://127.0.0.1:4319/mcp", token: "T" },
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
    expect(res).toEqual({ ok: true });
  });

  it("treats an already-registered server as success", async () => {
    const run: ClaudeRunner = async () => {
      throw new Error("MCP server airlock already exists");
    };
    expect(
      await registerMcpServer(
        { root: "/p", url: "http://127.0.0.1:4319/mcp", token: "T" },
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
        { root: "/p", url: "http://127.0.0.1:4319/mcp", token: "T" },
        run,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("scrubs the bearer token out of surfaced error messages", async () => {
    const run: ClaudeRunner = async () => {
      throw new Error("boom T");
    };
    const res = await registerMcpServer(
      { root: "/p", url: "http://127.0.0.1:4319/mcp", token: "T" },
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
