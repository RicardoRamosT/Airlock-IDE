import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectIdFor } from "./id";

describe("projectIdFor", () => {
  it("combines basename with an 8-char hash", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-id-"));
    const id = await projectIdFor(root);
    expect(id).toMatch(new RegExp(`^${path.basename(root)}-[0-9a-f]{8}$`));
  });

  it("is stable for the same path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "airlock-id-"));
    expect(await projectIdFor(root)).toBe(await projectIdFor(root));
  });

  it("differs for different paths with the same basename", async () => {
    const a = await mkdtemp(path.join(tmpdir(), "airlock-id-"));
    const b = await mkdtemp(path.join(tmpdir(), "airlock-id-"));
    const sameNameA = path.join(a, "proj");
    const sameNameB = path.join(b, "proj");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sameNameA);
    await mkdir(sameNameB);
    expect(await projectIdFor(sameNameA)).not.toBe(
      await projectIdFor(sameNameB),
    );
  });
});
