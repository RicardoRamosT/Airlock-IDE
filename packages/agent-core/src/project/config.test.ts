import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
      githubAccount: { host: "github.com", username: "RicardoRamosT" },
    });
    expect((await readProjectConfig(dir)).githubAccount).toEqual({
      host: "github.com",
      username: "RicardoRamosT",
    });
    // Passing undefined clears it (JSON.stringify omits undefined keys).
    await writeProjectConfig(dir, { githubAccount: undefined });
    expect((await readProjectConfig(dir)).githubAccount).toBeUndefined();
  });
});
