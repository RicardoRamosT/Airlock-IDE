import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readMeta, removeMeta, upsertMeta } from "./meta";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-meta-"));
});

const metaA = {
  name: "A",
  provider: null,
  valid: true,
  createdAt: "2026-06-03T00:00:00.000Z",
  updatedAt: "2026-06-03T00:00:00.000Z",
};

describe("secrets meta index", () => {
  it("reads empty when missing", async () => {
    expect(await readMeta(root)).toEqual([]);
  });

  it("upserts and persists", async () => {
    await upsertMeta(root, metaA);
    expect(await readMeta(root)).toEqual([metaA]);
    const updated = {
      ...metaA,
      provider: "jwt",
      updatedAt: "2026-06-04T00:00:00.000Z",
    };
    await upsertMeta(root, updated);
    expect(await readMeta(root)).toEqual([updated]);
  });

  it("keeps a one-version backup on rewrite", async () => {
    await upsertMeta(root, metaA);
    await upsertMeta(root, { ...metaA, name: "B" });
    const bak = JSON.parse(
      await readFile(path.join(root, ".airlock", "secrets.json.bak"), "utf8"),
    );
    expect(bak).toEqual([metaA]);
  });

  it("sorts by name and removes", async () => {
    await upsertMeta(root, { ...metaA, name: "ZZ" });
    await upsertMeta(root, { ...metaA, name: "AA" });
    expect((await readMeta(root)).map((m) => m.name)).toEqual(["AA", "ZZ"]);
    await removeMeta(root, "AA");
    expect((await readMeta(root)).map((m) => m.name)).toEqual(["ZZ"]);
  });
});
