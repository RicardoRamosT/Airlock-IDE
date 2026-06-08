import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveWithin } from "@airlock/agent-core";
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import type { LspCompletionItem, LspDefinition, LspDiagnostic } from "../../shared/ipc";
import { firstDefinitionLocation } from "./definition";

// One typescript-language-server child per workspace root (it needs the project
// root for tsconfig). Spawned lazily on the first didOpen; disposed when the
// root is no longer open in any window (syncLspServers, from window.ts). JSON-RPC
// over stdio via vscode-jsonrpc. ASCII-only file (bundled into the CJS main).

interface Server {
  proc: ReturnType<typeof spawn>;
  conn: MessageConnection;
  ready: Promise<void>;
}

const servers = new Map<string, Server>();

// Diagnostics sink, set by main (registerLspDiagnosticsSink) to a broadcast.
// Kept as a plain callback so this module has no electron dependency.
type DiagnosticsEvent = {
  root: string;
  relPath: string;
  diagnostics: LspDiagnostic[];
};
let sink: (e: DiagnosticsEvent) => void = () => {};
export function onLspDiagnostics(fn: (e: DiagnosticsEvent) => void): void {
  sink = fn;
}

// Map a file:// URI from the server back to a root-relative POSIX path, or null
// when it falls outside the root.
function uriToRel(root: string, uri: string): string | null {
  try {
    const abs = decodeURIComponent(new URL(uri).pathname);
    const rel = path.relative(root, abs);
    return rel.startsWith("..") ? null : rel.split(path.sep).join("/");
  } catch {
    return null;
  }
}

// Resolve a tsserver whose standard library is intact. In the packaged app,
// electron-builder strips .d.ts from the asar-bundled typescript, so its
// tsserver cannot resolve built-in types (string/array/etc. members, or
// type-aware diagnostics) -- it parses the file but reports zero members. We
// ship the whole typescript package via extraResources (to: ts-lib), preserving
// its lib/ layout, and point tsserver at ts-lib/lib/tsserver.js. tsserver locates
// its lib files relative to the PACKAGE ROOT (the package.json one level above
// lib/), so the directory structure -- not just the files -- must be intact.
// Dev/tests have no app resourcesPath (or it points at Electron's own), so
// existsSync fails and we fall back to the on-disk dependency, which is intact.
function tsserverPath(): string | undefined {
  const res = (process as { resourcesPath?: string }).resourcesPath;
  if (res) {
    const bundled = path.join(res, "ts-lib", "lib", "tsserver.js");
    if (existsSync(bundled)) return bundled;
  }
  try {
    return require.resolve("typescript/lib/tsserver.js");
  } catch {
    return undefined;
  }
}

function startServer(root: string): Server {
  // The main bundle is CJS, so require.resolve finds the externalized CLI; its
  // cli.mjs runs as ESM under Electron's Node mode (no separate node binary in a
  // packaged app).
  const cli = require.resolve("typescript-language-server/lib/cli.mjs");
  const proc = spawn(process.execPath, [cli, "--stdio"], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.on("error", (err) => console.error("[lsp] spawn failed", err));
  if (proc.stderr)
    proc.stderr.on("data", (d) => console.error("[lsp]", String(d).trim()));

  if (!proc.stdout || !proc.stdin) {
    throw new Error("lsp: child has no stdio");
  }
  const conn = createMessageConnection(
    new StreamMessageReader(proc.stdout),
    new StreamMessageWriter(proc.stdin),
  );
  conn.onError((e) => console.error("[lsp] connection error", e));
  conn.onNotification(
    "textDocument/publishDiagnostics",
    (p: { uri: string; diagnostics: LspDiagnostic[] }) => {
      const rel = uriToRel(root, p.uri);
      if (rel !== null)
        sink({ root, relPath: rel, diagnostics: p.diagnostics ?? [] });
    },
  );
  conn.listen();

  const ready = conn
    .sendRequest("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(root).toString(),
      initializationOptions: { tsserver: { path: tsserverPath() } },
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          publishDiagnostics: {},
        },
      },
    })
    .then(() => {
      conn.sendNotification("initialized", {});
    })
    .catch((err) => {
      console.error("[lsp] initialize failed", err);
    });

  return { proc, conn, ready };
}

function ensure(root: string): Server {
  let s = servers.get(root);
  if (!s) {
    s = startServer(root);
    servers.set(root, s);
  }
  return s;
}

async function uriOf(root: string, relPath: string): Promise<string> {
  return pathToFileURL(await resolveWithin(root, relPath)).toString();
}

export async function lspDidOpen(
  root: string,
  relPath: string,
  languageId: string,
  version: number,
  text: string,
): Promise<void> {
  const s = ensure(root);
  await s.ready;
  s.conn.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri: await uriOf(root, relPath),
      languageId,
      version,
      text,
    },
  });
}

export async function lspDidChange(
  root: string,
  relPath: string,
  version: number,
  text: string,
): Promise<void> {
  const s = servers.get(root);
  if (!s) return;
  await s.ready;
  s.conn.sendNotification("textDocument/didChange", {
    textDocument: { uri: await uriOf(root, relPath), version },
    contentChanges: [{ text }], // full-text sync
  });
}

export async function lspDidClose(
  root: string,
  relPath: string,
): Promise<void> {
  const s = servers.get(root);
  if (!s) return;
  await s.ready;
  s.conn.sendNotification("textDocument/didClose", {
    textDocument: { uri: await uriOf(root, relPath) },
  });
}

// LSP markup (string | { value } | array) -> a single string.
function markupToString(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents))
    return contents.map(markupToString).filter(Boolean).join("\n\n");
  if (contents && typeof contents === "object") {
    const v = (contents as { value?: unknown }).value;
    if (typeof v === "string") return v;
  }
  return "";
}

export async function lspHover(
  root: string,
  relPath: string,
  line: number,
  character: number,
): Promise<{ contents: string } | null> {
  const s = ensure(root);
  await s.ready;
  try {
    const r = (await s.conn.sendRequest("textDocument/hover", {
      textDocument: { uri: await uriOf(root, relPath) },
      position: { line, character },
    })) as unknown;
    if (!r || typeof r !== "object") return null;
    const contents = markupToString((r as { contents?: unknown }).contents);
    return contents ? { contents } : null;
  } catch (err) {
    console.error("[lsp] hover failed", err);
    return null;
  }
}

export async function lspCompletion(
  root: string,
  relPath: string,
  line: number,
  character: number,
): Promise<LspCompletionItem[]> {
  const s = ensure(root);
  await s.ready;
  try {
    const r = (await s.conn.sendRequest("textDocument/completion", {
      textDocument: { uri: await uriOf(root, relPath) },
      position: { line, character },
    })) as unknown;
    const raw: unknown[] = Array.isArray(r)
      ? r
      : r && typeof r === "object"
        ? ((r as { items?: unknown[] }).items ?? [])
        : [];
    return raw
      .map((x) => x as Record<string, unknown>)
      .map((it) => ({
        label: typeof it.label === "string" ? it.label : "",
        kind: typeof it.kind === "number" ? it.kind : undefined,
        detail: typeof it.detail === "string" ? it.detail : undefined,
        documentation: markupToString(it.documentation) || undefined,
        insertText:
          typeof it.insertText === "string" ? it.insertText : undefined,
      }))
      .filter((it) => it.label.length > 0);
  } catch (err) {
    console.error("[lsp] completion failed", err);
    return [];
  }
}

export async function lspDefinition(
  root: string,
  relPath: string,
  line: number,
  character: number,
): Promise<LspDefinition | null> {
  const s = ensure(root);
  await s.ready;
  try {
    const r = (await s.conn.sendRequest("textDocument/definition", {
      textDocument: { uri: await uriOf(root, relPath) },
      position: { line, character },
    })) as unknown;
    const loc = firstDefinitionLocation(r);
    if (!loc) return null;
    const rel = uriToRel(root, loc.uri);
    if (rel === null) return null; // definition is outside the workspace root
    return { relPath: rel, line: loc.line + 1 }; // 0-indexed LSP -> 1-indexed
  } catch (err) {
    console.error("[lsp] definition failed", err);
    return null;
  }
}

function disposeServer(root: string): void {
  const s = servers.get(root);
  if (!s) return;
  servers.delete(root);
  try {
    s.conn.sendNotification("exit");
    s.conn.dispose();
  } catch {
    // already gone
  }
  s.proc.kill();
}

// Dispose servers for roots no longer open in any window (called on
// workspace:roots changes and window close).
export function syncLspServers(openRoots: string[]): void {
  const keep = new Set(openRoots);
  for (const root of [...servers.keys()])
    if (!keep.has(root)) disposeServer(root);
}

export function disposeAllLspServers(): void {
  for (const root of [...servers.keys()]) disposeServer(root);
}
