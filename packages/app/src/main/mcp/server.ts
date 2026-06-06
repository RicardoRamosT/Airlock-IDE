// The airlock MCP server: a node:http listener bound to 127.0.0.1, guarded by a
// bearer token, wired to the @modelcontextprotocol/sdk streamable-HTTP server
// transport. Started on app-ready and stopped on quit (see main/index.ts).
//
// The server exposes the v1 read + UI-control tools (see ./tools) and the
// IDE-manual docs as read-only resources (see ./resources).
//
// Transport model: STATELESS (sessionIdGenerator: undefined). The SDK's stateless
// streamable-HTTP transport is single-use: its handleRequest throws "Stateless
// transport cannot be reused across requests. Create a new transport per request."
// the SECOND time it is called, and the @hono/node-server wrapper turns that throw
// into an opaque empty HTTP 500. So we build a FRESH McpServer + FRESH transport
// PER REQUEST (the documented stateless pattern), connect them, hand the parsed
// body to handleRequest, and close both when the response finishes. GET/DELETE
// have no SSE stream in stateless mode, so they are answered 405 directly. The
// SDK's own DNS-rebinding protection is left off because we bind loopback only and
// gate every request on the bearer token.
//
// To avoid a readdir per request the doc list is enumerated ONCE at startup and
// the cached list is registered onto each per-request server.
//
// ASCII-only comments: this module is CJS-bundled into the Electron main process
// and Electron's cjs_lexer crashes on multibyte characters.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { savePrefs } from "../prefs";
import { type DocEntry, loadDocList, registerDocResources } from "./resources";
import { registerTools } from "./tools";

export interface McpDeps {
  prefsFile: string;
  getWorkspaceRoot: () => string | null;
  getBaseEnv: () => Record<string, string>;
  requestSecretFromUser: (
    name: string,
    providerHint?: string,
  ) => Promise<{ vaulted: boolean; timedOut?: boolean; busy?: boolean }>;
  getTerminalTail: (
    termId: string,
    lines: number,
  ) => Promise<{ tail: string } | { error: string }>;
  listTerminals: () => Promise<{ id: string; preview: string }[]>;
  token: string;
}

// Module-level singletons: the listener is process-global and lives across
// window-close on darwin, only torn down on quit. There is intentionally NO
// long-lived McpServer/transport here -- both are created per request (see the
// transport model note above).
let httpServer: import("node:http").Server | null = null;

// How many sequential ports to try if the preferred one is taken. Keeps a busy
// port from crashing startup; the chosen port is persisted so the registered
// URL can be refreshed on the next folder-open.
const PORT_ATTEMPTS = 10;

// Largest request body we will buffer before parsing. MCP JSON-RPC requests are
// tiny; this just caps a hostile/runaway loopback client.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// Build a fresh McpServer with the v1 tools + the cached doc resources registered.
// Called PER REQUEST: the stateless SDK transport cannot be reused, so each request
// gets its own server connected to its own transport. registerTools is the SAME
// allowlist-locked registration used everywhere (tools.test.ts asserts it stays at
// exactly the eleven v1 tools and that none returns a secret value), so the security
// invariant holds identically on every per-request server.
function createMcpServer(deps: McpDeps, docs: DocEntry[]): McpServer {
  const mcp = new McpServer({ name: "airlock", version: "1.0.0" });

  // Register the v1 read + UI-control tools (see ./tools). Each is a thin
  // wrapper over the shared ide-state read layer / the menu visibility funnel;
  // none returns a secret value (tools.test.ts locks that invariant).
  registerTools(mcp, {
    prefsFile: deps.prefsFile,
    getWorkspaceRoot: deps.getWorkspaceRoot,
    getBaseEnv: deps.getBaseEnv,
    requestSecretFromUser: deps.requestSecretFromUser,
    getTerminalTail: deps.getTerminalTail,
    listTerminals: deps.listTerminals,
  });

  // Register the IDE-manual docs as read-only MCP resources from the list
  // enumerated once at startup. Doc CONTENT is still read at request time inside
  // each read callback, so an edited doc is served fresh.
  registerDocResources(mcp, docs);

  return mcp;
}

// Collect the full request body off the IncomingMessage stream and JSON.parse it.
// The SDK's handleRequest takes a pre-parsed body (it does not read the stream
// itself in this path), so we must buffer here. An empty body parses to undefined
// (tolerated -- e.g. a probe POST with no payload). Rejects on invalid JSON or an
// oversized body so the caller answers a clean error instead of crashing.
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// Write a JSON-RPC error response with the given HTTP status. Used for the 405 on
// GET/DELETE (no SSE stream in stateless mode) and the last-resort 500.
function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
  );
}

// Listen on 127.0.0.1, retrying the next port on EADDRINUSE. Resolves with the
// port actually bound. Any non-EADDRINUSE error (or running out of attempts)
// rejects so the caller can log it without crashing the app.
function listenWithFallback(
  server: import("node:http").Server,
  startPort: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let attemptsLeft = PORT_ATTEMPTS;
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && attemptsLeft > 1) {
        attemptsLeft -= 1;
        port += 1;
        // Retry on the next port. The error listener stays attached across
        // retries; success removes it below.
        server.listen(port, "127.0.0.1");
        return;
      }
      server.removeListener("error", onError);
      reject(err);
    };
    server.on("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      // Read the real bound port from address(): it differs from the requested
      // one after an EADDRINUSE bump, and when 0 was passed (ephemeral) the OS
      // assigns it. Falls back to the requested port if address() is null.
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
}

// Gate every request on the bearer token, then serve it with a per-request
// McpServer + transport, and bind the loopback listener. On success the bound
// port is persisted (it may differ from the requested one if the preferred port
// was taken).
export async function startMcpServer(
  port: number,
  deps: McpDeps,
): Promise<void> {
  // Enumerate the IDE-manual docs ONCE here; the cached list is registered onto
  // each per-request server so we never readdir on the request path.
  const docs = await loadDocList();

  // Capture in a local so the request handler closure does not read a stale value
  // if deps were ever to change; token is the authorization boundary.
  const token = deps.token;

  httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // Bearer gate FIRST -- reject before doing any work. Bind is loopback-only,
      // but the token is the actual authorization boundary.
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401;
        res.end("unauthorized");
        return;
      }

      // Stateless mode has no standalone SSE stream and no session to delete, so
      // only POST is meaningful. Answer GET/DELETE with a JSON-RPC 405 rather than
      // letting the transport try (and fail) to open a stream.
      if (req.method !== "POST") {
        sendJsonRpcError(res, 405, -32000, "Method not allowed.");
        return;
      }

      try {
        // Read + parse the body BEFORE handing to the SDK: its handleRequest takes
        // a pre-parsed body and does not consume the stream itself on this path.
        const body = await readJsonBody(req);

        // Fresh server + fresh transport PER REQUEST -- the stateless transport is
        // single-use (reuse throws and surfaces as an opaque 500).
        const server = createMcpServer(deps, docs);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        // Tear both down once the response is done so we do not leak a server +
        // transport per request.
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (err) {
        // Last resort: never let a handler error crash the listener. If nothing
        // has been sent yet, emit a JSON-RPC 500; otherwise the response is
        // already underway. NEVER log the token.
        console.error(
          "MCP request failed:",
          err instanceof Error ? err.message : err,
        );
        sendJsonRpcError(res, 500, -32603, "Internal error.");
      }
    },
  );

  const boundPort = await listenWithFallback(httpServer, port);
  // Persist the bound port so a later registration uses the correct URL. Only
  // write when it changed to avoid a needless prefs rewrite on every start.
  if (boundPort !== port) {
    await savePrefs(deps.prefsFile, {
      mcp: { port: boundPort, token: deps.token },
    });
  }
}

// Tear down the HTTP listener. Per-request servers/transports close themselves on
// their response 'close', so there is nothing process-global to close here. Safe
// to call when nothing is running.
export async function stopMcpServer(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (httpServer) httpServer.close(() => resolve());
    else resolve();
  });
  httpServer = null;
}

// The port the listener is actually bound to (may differ from the requested one
// after an EADDRINUSE bump), or null when the server is not running. Lets the
// registration step build the correct URL from the live port.
export function getMcpPort(): number | null {
  const addr = httpServer?.address();
  return typeof addr === "object" && addr ? addr.port : null;
}
