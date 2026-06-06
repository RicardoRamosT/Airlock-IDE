// The airlock IDE "manual" exposed as MCP resources: the markdown files under
// resources/mcp-docs/ are registered one-per-file so the terminal Claude can
// read about the IDE (its panes, the sidebar sections + when each is useful, the
// tool set, and the no-secrets security model) via resources/list + resources/read.
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

// One IDE-manual doc: its resource name and the absolute path to read at request
// time. Computed once by loadDocList() so the per-request server factory does not
// re-scan the docs dir on every MCP request.
export interface DocEntry {
  name: string;
  filePath: string;
}

// Enumerate the .md files under the docs dir, returning a stable {name, filePath}
// list. Called ONCE at startup (the server factory reuses this cached list per
// request). Best-effort: a missing or unreadable docs dir logs and returns []
// rather than throwing, since the docs are non-essential to the tool surface.
//
// dir is injectable so a test can point at a temp docs dir; production omits it
// and the packaged/dev path from docsDir() is used.
export async function loadDocList(
  dir: string = docsDir(),
): Promise<DocEntry[]> {
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
  return files.map((file) => ({
    name: file.slice(0, -".md".length),
    filePath: path.join(dir, file),
  }));
}

// Register each cached doc as a read-only MCP resource onto the given server.
// Called per request from the server factory with the list loadDocList() produced
// at startup. Each resource has a fixed airlock://docs/<name> URI and a read
// callback that returns the file's CURRENT text as text/markdown (read at request
// time so an edited doc is served fresh). Returns the registered names.
export function registerDocResources(
  mcp: McpServer,
  docs: DocEntry[],
): string[] {
  const registered: string[] = [];
  for (const { name, filePath } of docs) {
    const uri = docUri(name);
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

// Convenience used by tests and any one-shot caller: enumerate the docs dir and
// register them onto the server in one step. Resolves to the registered names.
// The server factory instead splits these (loadDocList once at startup,
// registerDocResources per request) to avoid a readdir on every MCP request.
export async function registerResources(
  mcp: McpServer,
  dir: string = docsDir(),
): Promise<string[]> {
  return registerDocResources(mcp, await loadDocList(dir));
}
