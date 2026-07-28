import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "./config";
import {
  patchProjectExtension,
  readProjectConfig,
  writeProjectConfig,
} from "./config";

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

// Two features writing DIFFERENT keys at the same time -- e.g. the Slack connect
// recording `workspace` while the channel picker saves `channels`. Each call
// merges its patch onto the file it read, so without serialization the later
// rename silently discards whatever the earlier one added: the allow-list
// disappears, or the workspace reads "unknown" seconds after being identified.
it("concurrent writes to different keys do not drop each other", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
  await writeProjectConfig(root, { devCommand: "seed" });

  await Promise.all([
    writeProjectConfig(root, { devUrl: "http://a" }),
    writeProjectConfig(root, { neonAccountId: "n1" }),
    writeProjectConfig(root, {
      extensions: { slack: { channels: ["C1"] } },
    } as Partial<ProjectConfig>),
  ]);

  const cfg = await readProjectConfig(root);
  const slack = cfg.extensions?.slack as { channels?: unknown[] } | undefined;
  expect({
    devCommand: cfg.devCommand,
    devUrl: cfg.devUrl,
    neonAccountId: cfg.neonAccountId,
    channels: slack?.channels,
  }).toEqual({
    devCommand: "seed",
    devUrl: "http://a",
    neonAccountId: "n1",
    channels: ["C1"],
  });
});

// A single unparseable byte must not become "defaults + patch" on the next
// write: that is the amplifier that turns one bad file into an emptied Slack
// allow-list and a forgotten devCommand.
it("preserves an unparseable config instead of overwriting it with defaults", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
  await writeProjectConfig(root, {
    devCommand: "npm run dev",
    extensions: { slack: { channels: ["C1", "C2"] } },
  } as Partial<ProjectConfig>);
  const file = path.join(root, ".airlock", "config.json");
  const good = await readFile(file, "utf8");
  // Exactly the corruption seen in the wild: the trailing brace is gone.
  await writeFile(file, good.trimEnd().slice(0, -1), "utf8");

  await writeProjectConfig(root, { devUrl: "http://x" });

  const kept = await readFile(`${file}.corrupt`, "utf8");
  expect(JSON.parse(`${kept.trimEnd()}}`).devCommand).toBe("npm run dev");
});

// patchProjectExtension exists because the ONLY safe way to touch one
// extension's sub-object is a read-modify-write, and doing that at the call
// site puts the READ outside the per-root write chain: two concurrent callers
// both read the same "before" map and the later write silently discards the
// earlier one's extension. That is the same data loss the chain already
// prevents for top-level keys, merely narrowed to `extensions`.
describe("patchProjectExtension", () => {
  it("merges into one extension without disturbing its siblings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    await writeProjectConfig(root, {
      extensions: {
        slack: { workspace: { id: "T1" }, channels: ["C1"] },
      },
    } as Partial<ProjectConfig>);

    await patchProjectExtension(root, "snowflake", { useHere: true });

    const cfg = await readProjectConfig(root);
    expect(cfg.extensions).toEqual({
      slack: { workspace: { id: "T1" }, channels: ["C1"] },
      snowflake: { useHere: true },
    });
  });

  it("merges into an extension that already has other keys, keeping them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    await writeProjectConfig(root, {
      extensions: { slack: { workspace: { id: "T1" }, channels: ["C1"] } },
    } as Partial<ProjectConfig>);

    await patchProjectExtension(root, "slack", { channels: ["C2"] });

    const slack = (await readProjectConfig(root)).extensions?.slack;
    expect(slack).toEqual({ workspace: { id: "T1" }, channels: ["C2"] });
  });

  it("leaves top-level config keys alone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    await writeProjectConfig(root, { devCommand: "npm run dev" });
    await patchProjectExtension(root, "azure", { useHere: true });
    expect((await readProjectConfig(root)).devCommand).toBe("npm run dev");
  });

  it("creates the extensions map when the project has none", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    await patchProjectExtension(root, "azure", { useHere: true });
    expect((await readProjectConfig(root)).extensions).toEqual({
      azure: { useHere: true },
    });
  });

  // THE point of the helper. Fired concurrently, both must survive -- a
  // read-modify-write at the call site loses one of them.
  it("does not lose a concurrent patch to a different extension", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    await Promise.all([
      patchProjectExtension(root, "azure", { useHere: true }),
      patchProjectExtension(root, "snowflake", { useHere: true }),
    ]);
    expect((await readProjectConfig(root)).extensions).toEqual({
      azure: { useHere: true },
      snowflake: { useHere: true },
    });
  });

  it("does not lose a concurrent patch to the SAME extension's other key", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
    await Promise.all([
      patchProjectExtension(root, "slack", { channels: ["C1"] }),
      patchProjectExtension(root, "slack", { workspace: { id: "T1" } }),
    ]);
    expect((await readProjectConfig(root)).extensions?.slack).toEqual({
      channels: ["C1"],
      workspace: { id: "T1" },
    });
  });
});

// Slack's connect capture needs the CURRENT slack config to decide whether to
// reset `channels` (the ids are workspace-scoped, so a workspace change makes
// the old list meaningless). Deciding that at the call site reads a snapshot a
// queued write may already have invalidated.
it("evaluates a function patch against the extension's post-predecessor state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "airlock-cfg-"));
  const seen: (Record<string, unknown> | undefined)[] = [];
  await Promise.all([
    patchProjectExtension(root, "slack", { workspace: { id: "T1" } }),
    patchProjectExtension(root, "slack", (cur) => {
      seen.push(cur);
      return { channels: ["C1"] };
    }),
  ]);
  // The second call saw the FIRST call's result, not the empty "before".
  expect(seen).toEqual([{ workspace: { id: "T1" } }]);
  expect((await readProjectConfig(root)).extensions?.slack).toEqual({
    workspace: { id: "T1" },
    channels: ["C1"],
  });
});
