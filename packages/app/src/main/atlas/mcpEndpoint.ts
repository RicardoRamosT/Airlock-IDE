// ASCII comments only. Where AirLock's own MCP server is listening, so Atlas
// can be handed it. Set once at startup, after ensureMcpConfig has resolved a
// stable port and token.
//
// A tiny module of its own rather than an import from index.ts, which would be
// a cycle: index imports the Atlas wiring, and the Atlas wiring needs this.

let endpoint: { port: number; token: string } | null = null;

export function setAtlasMcp(v: { port: number; token: string }): void {
  endpoint = v;
}

// Null until the server is up. Atlas then simply has no IDE tools that turn --
// a smaller capability, not an error.
export function atlasMcp(): { port: number; token: string } | null {
  return endpoint;
}
