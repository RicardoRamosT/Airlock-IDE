import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getMcpPort, startMcpServer, stopMcpServer } from "./server";

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
    token: TOKEN,
  });
  const port = getMcpPort();
  expect(port).not.toBeNull();
  return port as number;
}

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
