import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  installRunSkill,
  isRunSkillInstalled,
  type RunSkillPaths,
  uninstallRunSkill,
} from "./install";

const SKILL = "---\nname: airlock-run-app\ndescription: x\n---\nbody\n";

function setup(): { paths: RunSkillPaths; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "runskill-"));
  const src = path.join(root, "src-SKILL.md");
  writeFileSync(src, SKILL);
  return {
    paths: {
      source: src,
      skillDir: path.join(root, "skills", "airlock-run-app"),
    },
    root,
  };
}

describe("runskill install", () => {
  it("installs the shipped SKILL.md to skillDir/SKILL.md", async () => {
    const { paths } = setup();
    await installRunSkill(paths);
    const target = path.join(paths.skillDir, "SKILL.md");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(SKILL);
    expect(await isRunSkillInstalled(paths)).toBe(true);
  });
  it("is idempotent (second install is a no-op, content identical)", async () => {
    const { paths } = setup();
    await installRunSkill(paths);
    await installRunSkill(paths); // must not throw
    expect(readFileSync(path.join(paths.skillDir, "SKILL.md"), "utf8")).toBe(
      SKILL,
    );
  });
  it("uninstall removes OUR skill dir", async () => {
    const { paths } = setup();
    await installRunSkill(paths);
    await uninstallRunSkill(paths);
    expect(existsSync(paths.skillDir)).toBe(false);
    expect(await isRunSkillInstalled(paths)).toBe(false);
  });
  it("uninstall LEAVES a foreign skill (no airlock marker) untouched", async () => {
    const { paths } = setup();
    mkdirSync(paths.skillDir, { recursive: true });
    writeFileSync(
      path.join(paths.skillDir, "SKILL.md"),
      "---\nname: someone-else\n---\n",
    );
    await uninstallRunSkill(paths);
    expect(existsSync(path.join(paths.skillDir, "SKILL.md"))).toBe(true); // not ours -> left
  });
  it("uninstall when nothing installed is a no-op", async () => {
    const { paths } = setup();
    await uninstallRunSkill(paths); // must not throw
    expect(await isRunSkillInstalled(paths)).toBe(false);
  });
});
