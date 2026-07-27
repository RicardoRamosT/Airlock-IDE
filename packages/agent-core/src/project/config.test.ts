import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "./config";
import { readProjectConfig, writeProjectConfig } from "./config";

describe("project config", () => {
  it("defaults injectSecretsIntoTerminal to false", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    expect(await readProjectConfig(root)).toEqual({
      injectSecretsIntoTerminal: false,
    });
  });

  it("persists patches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    const next = await writeProjectConfig(root, {
      injectSecretsIntoTerminal: true,
    });
    expect(next.injectSecretsIntoTerminal).toBe(true);
    expect(await readProjectConfig(root)).toEqual({
      injectSecretsIntoTerminal: true,
    });
  });

  it("round-trips an optional githubAccount override", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cfg-gh-"));
    expect((await readProjectConfig(dir)).githubAccount).toBeUndefined();
    await writeProjectConfig(dir, {
      githubAccount: { host: "github.com", username: "octocat" },
    });
    expect((await readProjectConfig(dir)).githubAccount).toEqual({
      host: "github.com",
      username: "octocat",
    });
    // Passing undefined clears it (JSON.stringify omits undefined keys).
    await writeProjectConfig(dir, { githubAccount: undefined });
    expect((await readProjectConfig(dir)).githubAccount).toBeUndefined();
  });

  it("persists and reloads devCommand alongside devUrl", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    await writeProjectConfig(root, { devUrl: "http://localhost:3000" });
    const next = await writeProjectConfig(root, { devCommand: "npm run dev" });
    expect(next.devCommand).toBe("npm run dev");
    expect(next.devUrl).toBe("http://localhost:3000"); // patch merges, not replaces
    const reread = await readProjectConfig(root);
    expect(reread.devCommand).toBe("npm run dev");
  });

  it("persists per-extension config (e.g. Slack channel allow-list)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    await writeProjectConfig(root, {
      extensions: { slack: { channels: ["C123", "C456"] } },
    });
    const reread = await readProjectConfig(root);
    expect(reread.extensions?.slack).toEqual({ channels: ["C123", "C456"] });
    // A later top-level patch (devUrl) leaves extensions intact (shallow merge).
    await writeProjectConfig(root, { devUrl: "http://localhost:3000" });
    expect((await readProjectConfig(root)).extensions?.slack).toEqual({
      channels: ["C123", "C456"],
    });
  });
});

// Concurrent reads must always see a complete config. Note honestly: this test
// passes against the old truncating writeFile too -- an in-process interleaving
// that catches a half-written file could not be reproduced. The atomic
// write+rename is hardening, not a fix for a demonstrated failure. It matters
// because readProjectConfig turns ANY parse failure into DEFAULTS, so a torn
// read would present as every setting silently reverting rather than as an
// error.
it("never exposes a partial config to a concurrent reader", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cfg-race-"));
  // Big enough that the write spans several syscalls: a truncating writeFile
  // leaves a readable-but-incomplete file for a real interval, which is the
  // window a small config hides.
  const channels = Array.from({ length: 4000 }, (_, i) => ({
    id: `C${i}`,
    name: `channel-number-${i}-with-a-longish-name`,
    kind: "public",
  }));
  await writeProjectConfig(root, {
    extensions: { slack: { channels } },
  } as Partial<ProjectConfig>);

  const reads: Promise<unknown>[] = [];
  const writes: Promise<unknown>[] = [];
  for (let i = 0; i < 40; i++) {
    writes.push(writeProjectConfig(root, { devUrl: `http://localhost:${i}` }));
    reads.push(readProjectConfig(root));
  }
  await Promise.all(writes);
  const seen = await Promise.all(reads);

  // Every read saw a real config, never the defaults a parse failure returns.
  for (const cfg of seen) {
    const slack = (cfg as ProjectConfig).extensions?.slack as
      | { channels?: unknown[] }
      | undefined;
    expect(slack?.channels).toHaveLength(4000);
  }
});
