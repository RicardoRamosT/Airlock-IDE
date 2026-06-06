import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getMcpPort, startMcpServer, stopMcpServer } from "./server";
import { TOOL_NAMES } from "./tools";

const TOKEN = "test-token-abc123";

// Always tear the server down so a failed assertion cannot leave a listener
// bound and fail the next test.
afterEach(async () => {
  await stopMcpServer();
});

async function startOnEphemeralPort(): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), "airlock-mcp-srv-"));
  const prefsFile = path.join(dir, "prefs.json");
  // Port 0 -> the OS assigns a free ephemeral port (no clash with a real run).
  await startMcpServer(0, {
    prefsFile,
    getWorkspaceRoot: () => null,
    getBaseEnv: () => ({}),
    requestSecretFromUser: async () => ({ vaulted: true }),
    getTerminalTail: async () => ({ tail: "" }),
    listTerminals: async () => [],
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

  it("tools/list (after initialize) returns EXACTLY the twelve v1 tools", async () => {
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
    expect(names).toHaveLength(12);
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
