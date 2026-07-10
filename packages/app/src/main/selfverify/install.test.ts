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
  installSelfVerifySkill,
  isSelfVerifySkillInstalled,
  type SelfVerifyPaths,
  uninstallSelfVerifySkill,
} from "./install";

const SKILL = "---\nname: airlock-verify\ndescription: x\n---\nbody\n";

function setup(): { paths: SelfVerifyPaths; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "selfverify-"));
  const src = path.join(root, "src-SKILL.md");
  writeFileSync(src, SKILL);
  return {
    paths: {
      source: src,
      skillDir: path.join(root, "skills", "airlock-verify"),
    },
    root,
  };
}

describe("selfverify install", () => {
  it("installs the shipped SKILL.md to skillDir/SKILL.md", async () => {
    const { paths } = setup();
    await installSelfVerifySkill(paths);
    const target = path.join(paths.skillDir, "SKILL.md");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(SKILL);
    expect(await isSelfVerifySkillInstalled(paths)).toBe(true);
  });
  it("is idempotent (second install is a no-op, content identical)", async () => {
    const { paths } = setup();
    await installSelfVerifySkill(paths);
    await installSelfVerifySkill(paths); // must not throw
    expect(readFileSync(path.join(paths.skillDir, "SKILL.md"), "utf8")).toBe(
      SKILL,
    );
  });
  it("uninstall removes OUR skill dir", async () => {
    const { paths } = setup();
    await installSelfVerifySkill(paths);
    await uninstallSelfVerifySkill(paths);
    expect(existsSync(paths.skillDir)).toBe(false);
    expect(await isSelfVerifySkillInstalled(paths)).toBe(false);
  });
  it("uninstall LEAVES a foreign skill (no airlock marker) untouched", async () => {
    const { paths } = setup();
    mkdirSync(paths.skillDir, { recursive: true });
    writeFileSync(
      path.join(paths.skillDir, "SKILL.md"),
      "---\nname: someone-else\n---\n",
    );
    await uninstallSelfVerifySkill(paths);
    expect(existsSync(path.join(paths.skillDir, "SKILL.md"))).toBe(true);
  });
  it("uninstall when nothing installed is a no-op", async () => {
    const { paths } = setup();
    await uninstallSelfVerifySkill(paths); // must not throw
    expect(await isSelfVerifySkillInstalled(paths)).toBe(false);
  });
});
