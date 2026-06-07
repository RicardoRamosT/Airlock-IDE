import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureAirlockDir } from "./airlockDir";

describe("ensureAirlockDir", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "airlock-gi-"));
  });

  it("creates .airlock and writes an ignore-all .gitignore", async () => {
    const dir = await ensureAirlockDir(root);
    expect(dir).toBe(path.join(root, ".airlock"));
    const gi = await readFile(path.join(dir, ".gitignore"), "utf8");
    // "*" ignores everything in the dir (incl. itself) -> vault invisible to git.
    expect(gi).toContain("*");
  });

  it("does not overwrite an existing .gitignore (user edits preserved)", async () => {
    const dir = await ensureAirlockDir(root); // first run writes it
    const gi = path.join(dir, ".gitignore");
    await writeFile(gi, "# custom\n*\n", "utf8");
    await ensureAirlockDir(root); // second run must not clobber it
    expect(await readFile(gi, "utf8")).toBe("# custom\n*\n");
  });

  it("is idempotent when the dir already exists", async () => {
    await ensureAirlockDir(root);
    await expect(ensureAirlockDir(root)).resolves.toBe(
      path.join(root, ".airlock"),
    );
    await expect(
      access(path.join(root, ".airlock", ".gitignore")),
    ).resolves.toBeUndefined();
  });
});
