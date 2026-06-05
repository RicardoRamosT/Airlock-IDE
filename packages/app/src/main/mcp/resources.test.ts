import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerResources } from "./resources";

// A minimal McpServer stand-in that records every registerResource call.
// registerResources only ever calls .registerResource, so this captures the full
// registered surface (name, uri, config, callback) without the real SDK server.
type Recorded = {
  name: string;
  uri: string;
  config: { mimeType?: string };
  read: () => Promise<{
    contents: { uri: string; mimeType?: string; text: string }[];
  }>;
};

function fakeServer(): { mcp: McpServer; resources: Recorded[] } {
  const resources: Recorded[] = [];
  const mcp = {
    registerResource: (
      name: string,
      uri: string,
      config: Recorded["config"],
      read: Recorded["read"],
    ) => {
      resources.push({ name, uri, config, read });
    },
  } as unknown as McpServer;
  return { mcp, resources };
}

async function tempDocsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "airlock-mcp-docs-"));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(dir, name), body, "utf8");
  }
  return dir;
}

describe("registerResources", () => {
  it("registers one markdown resource per .md file", async () => {
    const dir = await tempDocsDir({
      "overview.md": "# Overview",
      "tools.md": "# Tools",
      // A non-md file must be ignored.
      "notes.txt": "ignore me",
    });
    const { mcp, resources } = fakeServer();

    const names = await registerResources(mcp, dir);

    expect(names.sort()).toEqual(["overview", "tools"]);
    expect(resources).toHaveLength(2);
    // Stable airlock://docs/<name> URI + markdown mime on each.
    const overview = resources.find((r) => r.name === "overview");
    expect(overview?.uri).toBe("airlock://docs/overview");
    expect(overview?.config.mimeType).toBe("text/markdown");
  });

  it("read callback returns the file's text as text/markdown at its uri", async () => {
    const dir = await tempDocsDir({
      "security-model.md": "# Security\nno values",
    });
    const { mcp, resources } = fakeServer();

    await registerResources(mcp, dir);
    const res = await resources[0]?.read();

    expect(res?.contents).toEqual([
      {
        uri: "airlock://docs/security-model",
        mimeType: "text/markdown",
        text: "# Security\nno values",
      },
    ]);
  });

  it("registers nothing (no throw) when the docs dir is missing", async () => {
    const { mcp, resources } = fakeServer();
    const names = await registerResources(
      mcp,
      path.join(tmpdir(), "airlock-does-not-exist-xyz"),
    );
    expect(names).toEqual([]);
    expect(resources).toHaveLength(0);
  });
});
