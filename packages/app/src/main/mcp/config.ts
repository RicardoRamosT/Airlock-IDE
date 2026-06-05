// Ensure a stable MCP server identity (HTTP port + bearer token), persisted in
// app-global prefs so the URL registered with Claude Code stays valid across
// launches. Pure read/write keyed by an explicit prefs file path (electron-free,
// node:crypto + the prefs store only) so it stays unit-testable.
//
// ASCII-only comments: this module is CJS-bundled into the Electron main process
// and Electron's cjs_lexer crashes on multibyte characters.
import { randomBytes } from "node:crypto";
import { loadPrefs, savePrefs } from "../prefs";

// Default loopback port for the MCP HTTP listener. A fixed default keeps the
// registered Claude Code URL stable; if the port is taken at listen time the
// server bumps it and persists the new value (see mcp/server.ts).
const DEFAULT_PORT = 4319;

// Return the persisted {port, token} if prefs already carry a well-formed mcp
// identity; otherwise generate a fresh token + default port, persist them, and
// return the generated value. The token is 24 random bytes hex-encoded (48
// chars). Idempotent: a second call returns the same stored value unchanged.
export async function ensureMcpConfig(
  prefsFile: string,
): Promise<{ port: number; token: string }> {
  const prefs = await loadPrefs(prefsFile);
  // loadPrefs/sanitize already drop a malformed mcp field, so a present mcp here
  // is guaranteed well-formed (finite port + non-empty token).
  if (prefs.mcp) return prefs.mcp;
  const mcp = { port: DEFAULT_PORT, token: randomBytes(24).toString("hex") };
  await savePrefs(prefsFile, { mcp });
  return mcp;
}
