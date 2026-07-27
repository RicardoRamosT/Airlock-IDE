import type { EmitInput } from "@airlock/agent-core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { withToolLogging } from "./toolLog";

// A stand-in that records registrations and lets a test invoke the (wrapped)
// handler, without standing up the real SDK server or Electron.
function fakeServer() {
  const tools: {
    name: string;
    handler: (...args: unknown[]) => Promise<unknown>;
  }[] = [];
  const mcp = {
    registerTool: (
      name: string,
      _config: unknown,
      handler: (...args: unknown[]) => Promise<unknown>,
    ) => {
      tools.push({ name, handler });
    },
    // A second method, to prove the Proxy leaves the rest of the server alone.
    connect: () => "connected",
  } as unknown as McpServer;
  return { mcp, tools };
}

function setup() {
  const emitted: EmitInput[] = [];
  const { mcp, tools } = fakeServer();
  const wrapped = withToolLogging(mcp, (e) => {
    emitted.push(e);
  });
  // The SDK's registerTool is generic over a zod input schema; these fixtures
  // are plain handlers, so the cast is confined to this one helper.
  const register = (name: string, handler: (...a: unknown[]) => unknown) =>
    (
      wrapped.registerTool as unknown as (
        n: string,
        c: unknown,
        h: (...a: unknown[]) => unknown,
      ) => void
    )(name, {}, handler);
  return { register, tools, emitted, wrapped };
}

describe("withToolLogging", () => {
  it("emits one tool-category event per call, keyed by tool name", async () => {
    // The whole point: read_events(category:"tool") used to return [], so
    // "which tools does anyone actually use" had no answer.
    const { register, tools, emitted } = setup();
    register("git_status", async () => ({ ok: true }));
    await tools[0]?.handler({});

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      category: "tool",
      op: "tool.git_status",
      actor: "agent",
      outcome: "ok",
      level: "info",
    });
    expect(typeof emitted[0]?.durationMs).toBe("number");
  });

  it("passes the tool's arguments and result straight through", async () => {
    const { register, tools } = setup();
    const impl = vi.fn(async (args: unknown) => ({ echoed: args }));
    register("open_tab", impl as never);
    const out = await tools[0]?.handler({ path: "/tmp/p" });

    expect(impl).toHaveBeenCalledWith({ path: "/tmp/p" });
    expect(out).toEqual({ echoed: { path: "/tmp/p" } });
  });

  it("NEVER records the arguments -- they can carry a credential", async () => {
    // send_terminal_input carries whatever the user is typing; run_command
    // carries a command line. Logging either would put secrets in the log for
    // no gain, since the tool name alone answers the usage question.
    const { register, tools, emitted } = setup();
    register("send_terminal_input", async () => ({ ok: true }));
    await tools[0]?.handler({ text: "export TOKEN=sk-live-SUPERSECRET" });

    expect(JSON.stringify(emitted)).not.toContain("SUPERSECRET");
    expect(JSON.stringify(emitted)).not.toContain("TOKEN");
  });

  it("records an isError result as outcome error, without its message", async () => {
    const { register, tools, emitted } = setup();
    register("git_commit", async () => ({
      isError: true,
      content: [{ type: "text", text: "failed for sk-live-SUPERSECRET" }],
    }));
    await tools[0]?.handler({});

    expect(emitted[0]).toMatchObject({ outcome: "error", level: "warn" });
    expect(JSON.stringify(emitted)).not.toContain("SUPERSECRET");
  });

  it("records a throw as an error event and rethrows it", async () => {
    const { register, tools, emitted } = setup();
    register("docker_status", async () => {
      throw new Error("daemon down");
    });

    await expect(tools[0]?.handler({})).rejects.toThrow("daemon down");
    expect(emitted[0]).toMatchObject({
      level: "error",
      outcome: "error",
      op: "tool.docker_status",
    });
    expect(emitted[0]?.error?.message).toBe("daemon down");
  });

  it("instruments every tool registered, not just the first", async () => {
    // The reason this is a decorator and not 39 edits: a tool added later is
    // instrumented without anyone remembering to do it.
    const { register, tools, emitted } = setup();
    register("a", async () => ({}));
    register("b", async () => ({}));
    await tools[0]?.handler({});
    await tools[1]?.handler({});

    expect(emitted.map((e) => e.op)).toEqual(["tool.a", "tool.b"]);
  });

  it("leaves the server's other methods working", () => {
    // A Proxy, not a copy: McpServer's other methods must still resolve, with
    // their own `this`. Only registerTool is intercepted.
    const { wrapped } = setup();
    expect((wrapped as unknown as { connect: () => string }).connect()).toBe(
      "connected",
    );
  });
});
