import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveWithin } from "@airlock/agent-core";
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import type { LspDiagnostic } from "../../shared/ipc";

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
