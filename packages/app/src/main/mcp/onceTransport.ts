// packages/app/src/main/mcp/onceTransport.ts
// A minimal request/response MCP transport: one parsed JSON-RPC body in, the
// matching replies out. It replaces the SDK's streamable-HTTP transport for
// AirLock's stateless localhost server.
//
// WHY WE OWN THIS (diagnosed 2026-07-26). The SDK's Node transport bridges to a
// Web-standard transport via @hono/node-server, so the reply body is encoded by
// a Web `Response` object. Electron's UTF-8 encoder mis-sizes certain V8 string
// shapes -- for one 116-character JSON string it reported 113 bytes, which is
// impossible (a UTF-8 length can never be below the character count) -- and the
// body went out truncated by exactly that shortfall. Symptoms: a Slack channel
// containing an accented name read as EMPTY, and before that an SSE frame lost
// its trailing "\n\n" so every tool call hung for 300s.
//
// The corruption happens inside `Response`'s internal encoding, which is not
// reachable from JavaScript -- patching Buffer would not help. The only fix is
// to never hand a string to that layer: we build the bytes ourselves here and
// verify them (see encodeJson). Neither hono nor the SDK is at fault; both are
// byte-correct in isolation on this runtime.
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// How long to wait for the server's replies before answering with what we have.
// A bound matters: a tool that never resolves must not hold the socket open
// forever (that is the 300s hang this whole change exists to prevent).
const REPLY_TIMEOUT_MS = 120_000;

// Encode a JSON-RPC value to the exact bytes to write.
//
// The guard: encode, then decode and compare. Electron's whole-string encoder is
// wrong for some strings but correct per-character, so a failed comparison falls
// back to encoding character by character. Costly, but it only ever runs on the
// strings the runtime gets wrong.
export function encodeJson(value: unknown): Buffer {
  const json = JSON.stringify(value);
  const buf = Buffer.from(json, "utf8");
  if (buf.toString("utf8") === json) return buf;
  return Buffer.concat(Array.from(json, (ch) => Buffer.from(ch, "utf8")));
}

// A JSON-RPC message earns a reply only if it carries an id: notifications do
// not. Counting them tells us how many sends to await, so a notification-only
// POST answers at once instead of waiting for a reply that will never come.
export function expectedReplies(body: unknown): number {
  const one = (m: unknown): number => {
    if (!m || typeof m !== "object") return 0;
    const id = (m as { id?: unknown }).id;
    return id === undefined || id === null ? 0 : 1;
  };
  if (Array.isArray(body)) return body.reduce((n, m) => n + one(m), 0);
  return one(body);
}

export class OnceTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
  sessionId?: string;

  private replies: JSONRPCMessage[] = [];
  private want = 0;
  private settle: (() => void) | null = null;

  async start(): Promise<void> {}

  // The SDK calls this for each outgoing message. Collect it, and release
  // handle() once every expected reply has arrived.
  async send(message: JSONRPCMessage): Promise<void> {
    this.replies.push(message);
    if (this.settle && this.replies.length >= this.want) {
      const settle = this.settle;
      this.settle = null;
      settle();
    }
  }

  async close(): Promise<void> {
    // Release a pending handle() so a close mid-request cannot hang the socket.
    if (this.settle) {
      const settle = this.settle;
      this.settle = null;
      settle();
    }
    this.onclose?.();
  }

  // Feed one parsed body in and resolve with the replies the server produced.
  async handle(
    body: unknown,
    timeoutMs = REPLY_TIMEOUT_MS,
  ): Promise<JSONRPCMessage[]> {
    this.replies = [];
    this.want = expectedReplies(body);

    const messages: unknown[] = Array.isArray(body) ? body : [body];
    if (this.want === 0) {
      for (const m of messages) this.onmessage?.(m as JSONRPCMessage);
      return this.replies;
    }

    const done = new Promise<void>((resolve) => {
      this.settle = resolve;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    for (const m of messages) this.onmessage?.(m as JSONRPCMessage);
    try {
      await Promise.race([done, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      this.settle = null;
    }
    return this.replies;
  }
}
