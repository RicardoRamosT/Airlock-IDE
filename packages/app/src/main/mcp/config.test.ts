import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPrefs } from "../prefs";
import { ensureMcpConfig } from "./config";

describe("ensureMcpConfig", () => {
  it("generates and persists an identity when prefs has no mcp", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-mcp-cfg-"));
    const file = path.join(dir, "prefs.json");

    const cfg = await ensureMcpConfig(file);
    expect(cfg.port).toBe(4319);
    // 24 random bytes hex-encoded -> 48 chars.
    expect(cfg.token).toMatch(/^[0-9a-f]{48}$/);

    // It was actually written to disk, not just returned.
    expect((await loadPrefs(file)).mcp).toEqual(cfg);
  });

  it("returns the stored identity unchanged when already present", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-mcp-cfg-"));
    const file = path.join(dir, "prefs.json");

    const first = await ensureMcpConfig(file);
    const second = await ensureMcpConfig(file);
    // Idempotent: same port AND same token (not regenerated).
    expect(second).toEqual(first);
  });
});
