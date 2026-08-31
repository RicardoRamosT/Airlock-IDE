import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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

  // M7: a file that PARSES but is not an array of entries is corruption, not
  // empty -- readMeta must throw, never silently return [] (which would make the
  // secrets look gone and let the next write clobber the backup).
  it("throws on a non-array or unparseable secrets.json (M7)", async () => {
    await upsertMeta(root, metaA); // create .airlock + a valid file
    const file = path.join(root, ".airlock", "secrets.json");
    await writeFile(file, '{"not":"an array"}');
    await expect(readMeta(root)).rejects.toThrow(/corrupt/i);
    await writeFile(file, "{ not even json");
    await expect(readMeta(root)).rejects.toThrow(/corrupt/i);
    await writeFile(file, '[{"noName":true}]'); // array of wrong-shape entries
    await expect(readMeta(root)).rejects.toThrow(/corrupt/i);
  });

  // M8: with a corrupt file, a write must NOT proceed -- otherwise it copies the
  // corrupt file over the .bak and persists a degraded list, losing the name
  // index. The write throws and the good .bak is preserved for recovery.
  it("does not clobber the .bak when the file is corrupt (M8)", async () => {
    await upsertMeta(root, metaA); // write 1 (no .bak yet)
    await upsertMeta(root, { ...metaA, name: "B" }); // write 2 -> .bak = [A]
    const file = path.join(root, ".airlock", "secrets.json");
    await writeFile(file, "CORRUPT NOT JSON");
    await expect(upsertMeta(root, { ...metaA, name: "C" })).rejects.toThrow(
      /corrupt/i,
    );
    const bakText = await readFile(`${file}.bak`, "utf8");
    expect(Array.isArray(JSON.parse(bakText))).toBe(true); // good backup intact
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

  it("writes the meta file with 0o600 permissions", async () => {
    await upsertMeta(root, metaA);
    const s = await stat(path.join(root, ".airlock", "secrets.json"));
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("survives concurrent upserts without a torn index", async () => {
    // The temp file used to be a FIXED `${file}.tmp`, shared by every writer, so
    // two overlapping upserts could interleave into it and the rename would
    // publish a torn result -- which readMeta THROWS on, wedging every secret
    // operation in that project. Each write now uses a unique temp name.
    //
    // It also caught a bigger bug than the temp name: with no serialization at
    // all, 20 concurrent upserts each read the SAME empty baseline and the last
    // rename won -- ONE name survived out of 20. Importing a .env upserts every
    // name at once, so this was the ordinary path, not a corner case.
    const now = new Date().toISOString();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        upsertMeta(root, {
          name: `S${i}`,
          provider: null,
          valid: false,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );
    const out = await readMeta(root); // throws if the JSON is torn
    expect(out.map((m) => m.name).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `S${i}`).sort(),
    );
  });

  it("leaves no temp file behind after a write", async () => {
    const now = new Date().toISOString();
    await upsertMeta(root, {
      name: "A",
      provider: null,
      valid: false,
      createdAt: now,
      updatedAt: now,
    });
    const { readdir } = await import("node:fs/promises");
    const left = (await readdir(path.join(root, ".airlock"))).filter((n) =>
      n.endsWith(".tmp"),
    );
    expect(left).toEqual([]);
  });
});
