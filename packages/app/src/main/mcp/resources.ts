// The airlock IDE "manual" exposed as MCP resources: the markdown files under
// resources/mcp-docs/ are registered one-per-file so the terminal Claude can
// read about the IDE (its panes, the sidebar sections + when each is useful, the
// 9 tools, and the no-secrets security model) via resources/list + resources/read.
//
// These are pure docs -- read-only text, no secret values, no app state. The
// content lives in .md files (NOT bundled into this JS), so only this loader is
// ASCII-constrained; the markdown itself may use normal prose/unicode freely.
//
// ASCII-only comments: this module is CJS-bundled into the Electron main process
// and Electron's cjs_lexer crashes on multibyte characters.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { app } from "electron";

// Resolve the docs dir the same way index.ts resolves the bundled icon: in a
// packaged .app electron-builder's extraResources drops mcp-docs/ at
// process.resourcesPath; in dev the files sit beside the source under
// packages/app/resources/mcp-docs (two levels up from out/main at runtime, which
// maps to src/main here -- the relative hop is identical in both layouts).
function docsDir(): string {
  // app is undefined outside Electron (e.g. unit tests import this module's
  // sibling without an Electron runtime); fall back to the source-relative dev
  // path so resolution never throws. In a real run app is always present.
  return app?.isPackaged
    ? path.join(process.resourcesPath, "mcp-docs")
    : path.join(__dirname, "../../resources/mcp-docs");
}

// Stable URI scheme for a doc file: airlock://docs/<name> where <name> is the
// filename without its .md extension (e.g. airlock://docs/overview).
function docUri(name: string): string {
  return `airlock://docs/${name}`;
}

// Register every .md file under the docs dir as an MCP resource. Called once at
// startup from startMcpServer (after registerTools). Each resource has a fixed
// URI and a read callback that returns the file's current text as text/markdown.
// Enumerating the dir keeps the resource set in lockstep with the authored files
// -- adding a new .md needs no code change here.
//
// Resolves to the list of registered names (for tests / logging). On a missing
// or unreadable docs dir this is best-effort: it logs and registers nothing
// rather than failing server startup, since the docs are non-essential to the
// tool surface.
//
// dir is injectable so a test can point at a temp docs dir; production omits it
// and the packaged/dev path from docsDir() is used.
export async function registerResources(
  mcp: McpServer,
  dir: string = docsDir(),
): Promise<string[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  } catch (e) {
    console.error(
      "MCP resources: could not read docs dir",
      dir,
      e instanceof Error ? e.message : e,
    );
    return [];
  }

  const registered: string[] = [];
  for (const file of files) {
    const name = file.slice(0, -".md".length);
    const uri = docUri(name);
    const filePath = path.join(dir, file);
    mcp.registerResource(
      name,
      uri,
      {
        title: name,
        description: `airlock IDE manual: ${name}`,
        mimeType: "text/markdown",
      },
      async () => {
        // Read at request time so an edited doc is served fresh. The callback's
        // own uri arg is a URL; we return the canonical string form we registered.
        const text = await readFile(filePath, "utf8");
        return {
          contents: [{ uri, mimeType: "text/markdown", text }],
        };
      },
    );
    registered.push(name);
  }
  return registered;
}
