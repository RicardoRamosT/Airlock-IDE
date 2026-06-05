// The airlock MCP server: a node:http listener bound to 127.0.0.1, guarded by a
// bearer token, wired to the @modelcontextprotocol/sdk streamable-HTTP server
// transport. Started on app-ready and stopped on quit (see main/index.ts).
//
// This task stands up the server + lifecycle + a stable port/token and registers
// a single trivial 'ping' tool so it starts cleanly. Task 5 registers the real
// read/UI-control tools and Task 6 the doc resources -- both onto the live
// McpServer returned by getMcpServer().
//
// Transport model: STATELESS (sessionIdGenerator: undefined). One transport is
// connected to the McpServer once at startup and every request is handed to
// transport.handleRequest after the bearer gate, so there is no per-session
// transport bookkeeping. The SDK's own DNS-rebinding protection is left off
// because we bind loopback only and gate every request on the bearer token.
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
import { registerResources } from "./resources";
import { registerTools } from "./tools";

export interface McpDeps {
  prefsFile: string;
  getWorkspaceRoot: () => string | null;
  token: string;
}

// Module-level singletons: the server is process-global and lives across
// window-close on darwin, only torn down on quit.
let httpServer: import("node:http").Server | null = null;
let mcp: McpServer | null = null;
let transport: StreamableHTTPServerTransport | null = null;

// How many sequential ports to try if the preferred one is taken. Keeps a busy
// port from crashing startup; the chosen port is persisted so the registered
// URL can be refreshed on the next folder-open.
const PORT_ATTEMPTS = 10;

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

// Build the McpServer + transport, gate every request on the bearer token, and
// bind the loopback listener. On success the bound port is persisted (it may
// differ from the requested one if the preferred port was taken).
export async function startMcpServer(
  port: number,
  deps: McpDeps,
): Promise<void> {
  mcp = new McpServer({ name: "airlock", version: "1.0.0" });

  // Register the v1 read + UI-control tools (see ./tools). Each is a thin
  // wrapper over the shared ide-state read layer / the menu visibility funnel;
  // none returns a secret value (tools.test.ts locks that invariant).
  registerTools(mcp, {
    prefsFile: deps.prefsFile,
    getWorkspaceRoot: deps.getWorkspaceRoot,
  });

  // Register the IDE-manual docs as read-only MCP resources (see ./resources).
  // Best-effort: a missing docs dir logs and registers nothing rather than
  // failing startup, so the tool surface is unaffected.
  await registerResources(mcp);

  // Stateless transport: no session id, so one instance serves every request.
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcp.connect(transport);

  // Capture in locals so the request handler closure does not race a later
  // stopMcpServer() that nulls the module singletons.
  const activeTransport = transport;
  const token = deps.token;

  httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // Bearer gate FIRST -- reject before touching the transport. Bind is
      // loopback-only, but the token is the actual authorization boundary.
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401;
        res.end("unauthorized");
        return;
      }
      try {
        await activeTransport.handleRequest(req, res);
      } catch (err) {
        // Never let a transport error crash the listener. If nothing has been
        // sent yet, emit a 500; otherwise the response is already underway.
        console.error(
          "MCP request failed:",
          err instanceof Error ? err.message : err,
        );
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("internal error");
        }
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

// Tear down in order: close the McpServer (and thus the transport), then the
// HTTP listener. Safe to call when nothing is running.
export async function stopMcpServer(): Promise<void> {
  await mcp?.close?.();
  await new Promise<void>((resolve) => {
    if (httpServer) httpServer.close(() => resolve());
    else resolve();
  });
  httpServer = null;
  mcp = null;
  transport = null;
}

// The live McpServer so Tasks 5/6 can register tools/resources after start.
export function getMcpServer(): McpServer | null {
  return mcp;
}

// The port the listener is actually bound to (may differ from the requested one
// after an EADDRINUSE bump), or null when the server is not running. Lets the
// registration step build the correct URL from the live port.
export function getMcpPort(): number | null {
  const addr = httpServer?.address();
  return typeof addr === "object" && addr ? addr.port : null;
}
