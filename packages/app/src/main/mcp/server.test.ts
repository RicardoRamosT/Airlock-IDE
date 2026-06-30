import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getMcpPort, startMcpServer, stopMcpServer } from "./server";
import { TOOL_NAMES } from "./tools";

const TOKEN = "test-token-abc123";

// A rootForToken factory for tests: maps a fixed token -> root pair.
function makeRootForToken(
  map: Record<string, string>,
): (token: string | null) => string | null {
  return (token) => (token ? (map[token] ?? null) : null);
}

// Always tear the server down so a failed assertion cannot leave a listener
// bound and fail the next test.
afterEach(async () => {
  await stopMcpServer();
});

async function startOnEphemeralPort(
  rootForToken?: (token: string | null) => string | null,
): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), "airlock-mcp-srv-"));
  const prefsFile = path.join(dir, "prefs.json");
  // Port 0 -> the OS assigns a free ephemeral port (no clash with a real run).
  await startMcpServer(0, {
    prefsFile,
    rootForToken: rootForToken ?? (() => null),
    getBaseEnv: () => ({}),
    requestSecretFromUser: async () => ({ vaulted: true }),
    getTerminalTail: async () => ({ tail: "" }),
    listTerminals: async () => [],
    // Stub the gated terminal-input dep so the McpDeps literal type-checks; the
    // server-level tests assert the tool SURFACE (count/names), not the gated
    // write behavior (that is covered in tools.test.ts).
    sendTerminalInput: async () => ({ sent: true as const }),
    getActivity: async () => [],
    dismissActivity: () => {},
    importEnvFiles: async () => [],
    notifySecretsChanged: () => {},
    getQuota: () => null,
    getUsageLedger: () => [],
    // Stub the IDE-control round-trip so the McpDeps literal type-checks; the
    // server-level tests assert the tool SURFACE (count/names), not the layout
    // behavior (that is covered in tools.test.ts + the renderer hook).
    runAgentCommand: async () => ({
      ok: true,
      data: { tabs: [], split: null, appPages: { open: [], shown: null } },
    }),
    // Stub the managed dev-server deps so the McpDeps literal type-checks; the
    // server-level tests assert the tool SURFACE (count/names), not the
    // dev-server behavior (covered in tools.test.ts + manager.test.ts).
    getDevServerState: () => ({
      status: "idle" as const,
      port: null,
      url: null,
      terminalId: null,
      command: null,
      startedBy: null,
      exitCode: null,
    }),
    startDevServer: async () => ({
      ok: true,
      state: {
        status: "idle" as const,
        port: null,
        url: null,
        terminalId: null,
        command: null,
        startedBy: null,
        exitCode: null,
      },
    }),
    stopDevServer: () => ({
      status: "idle" as const,
      port: null,
      url: null,
      terminalId: null,
      command: null,
      startedBy: null,
      exitCode: null,
    }),
    token: TOKEN,
  });
  const port = getMcpPort();
  expect(port).not.toBeNull();
  return port as number;
}

// POST a JSON-RPC request with the valid bearer token and Accept that allows both
// direct-JSON and SSE-framed responses (streamable-HTTP may return either). The
// SDK frames its JSON in a text/event-stream "data:" line; this normalizes both
// shapes back to the parsed JSON-RPC object so tests assert on one shape.
async function rpc(
  port: number,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  let json: Record<string, unknown> | null = null;
  if (text.length > 0) {
    if (contentType.includes("text/event-stream")) {
      // Extract the JSON payload from the first SSE "data:" line.
      const line = text
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice("data:".length)
        .trim();
      json = line ? JSON.parse(line) : null;
    } else {
      json = JSON.parse(text);
    }
  }
  return { status: res.status, json };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

describe("MCP server bearer gate", () => {
  it("binds 127.0.0.1 and 401s a request with NO Authorization header", async () => {
    const port = await startOnEphemeralPort();
    // Loopback bind: the URL is explicitly 127.0.0.1, proving it is reachable
    // there (and the listen call bound that host only).
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("unauthorized");
  });

  it("401s a request with the WRONG bearer token", async () => {
    const port = await startOnEphemeralPort();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("stopMcpServer closes the listener", async () => {
    const port = await startOnEphemeralPort();
    await stopMcpServer();
    // After stop there is no bound port and the socket refuses connections.
    expect(getMcpPort()).toBeNull();
    await expect(fetch(`http://127.0.0.1:${port}/mcp`)).rejects.toThrow();
  });
});

// The coverage that was missing when the single-reused-transport bug shipped:
// a real MCP handshake. Each authenticated POST is independent (stateless mode
// returns no session id), so initialize and tools/list are sent as separate
// requests and BOTH must succeed -- the old code 500'd on the second one.
describe("MCP server handshake", () => {
  it("initialize returns 200 with the airlock serverInfo + capabilities", async () => {
    const port = await startOnEphemeralPort();
    const { status, json } = await rpc(port, INITIALIZE);
    expect(status).toBe(200);
    const result = json?.result as
      | { serverInfo?: { name?: string }; capabilities?: unknown }
      | undefined;
    expect(result?.serverInfo?.name).toBe("airlock");
    expect(result?.capabilities).toBeDefined();
  });

  it("tools/list (after initialize) returns EXACTLY the thirty-one allowlisted tools", async () => {
    const port = await startOnEphemeralPort();
    // A real client initializes first; with a fresh per-request transport this
    // second request must also succeed (the reused-transport bug 500'd here).
    const init = await rpc(port, INITIALIZE);
    expect(init.status).toBe(200);

    const { status, json } = await rpc(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(status).toBe(200);
    const tools = (json?.result as { tools?: { name: string }[] } | undefined)
      ?.tools;
    expect(tools).toBeDefined();
    const names = (tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    // Spell out the count so a drift in TOOL_NAMES is obvious here too.
    expect(names).toHaveLength(31);
  });

  it("GET (even authenticated) is 405 -- stateless mode has no SSE stream", async () => {
    const port = await startOnEphemeralPort();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(405);
  });

  it("an unauthenticated GET is still 401 (gate runs before the 405)", async () => {
    const port = await startOnEphemeralPort();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "GET" });
    expect(res.status).toBe(401);
  });
});

// Per-request path token: the server resolves the project root from the URL path
// /mcp/<token>. A missing/unknown token -> rootForToken returns null -> tools
// answer NO_WORKSPACE (focus is NOT consulted). A known token -> the tool sees
// that project's root.
describe("MCP server per-request path token", () => {
  // Sends a tools/call for list_secret_names (workspace-gated) and returns the
  // parsed tool result (text content string), or throws on a non-200 status.
  async function callListSecretNames(
    port: number,
    projectToken: string | null,
  ): Promise<string> {
    const urlPath = projectToken ? `/mcp/${projectToken}` : "/mcp";
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_secret_names", arguments: {} },
      }),
    });
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    let json: Record<string, unknown> | null = null;
    if (contentType.includes("text/event-stream")) {
      const line = text
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice("data:".length)
        .trim();
      json = line ? JSON.parse(line) : null;
    } else {
      json = JSON.parse(text);
    }
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    const result = (json as any)?.result;
    return (result?.content?.[0]?.text as string) ?? "";
  }

  it("a missing path token (bare /mcp) yields NO_WORKSPACE for a workspace-gated tool", async () => {
    // rootForToken always returns null -> unknown token -> refuse.
    const port = await startOnEphemeralPort(makeRootForToken({}));
    const text = await callListSecretNames(port, null);
    expect(text).toBe("No workspace open");
  });

  it("an unknown path token yields NO_WORKSPACE for a workspace-gated tool", async () => {
    const port = await startOnEphemeralPort(makeRootForToken({}));
    const text = await callListSecretNames(port, "unknown-token-deadbeef");
    expect(text).toBe("No workspace open");
  });
});
