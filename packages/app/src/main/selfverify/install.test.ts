import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  installSelfVerifySkill,
  isSelfVerifySkillInstalled,
  type SelfVerifyPaths,
  uninstallSelfVerifySkill,
} from "./install";

let dir: string;
let p: SelfVerifyPaths;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "selfverify-"));
  await writeFile(
    path.join(dir, "SKILL.md"),
    "---\nname: airlock-verify\n---\nbody\n",
  );
  p = {
    source: path.join(dir, "SKILL.md"),
    skillDir: path.join(dir, "installed"),
  };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it("installs, reports installed, and uninstalls our skill", async () => {
  expect(await isSelfVerifySkillInstalled(p)).toBe(false);
  await installSelfVerifySkill(p);
  expect(await isSelfVerifySkillInstalled(p)).toBe(true);
  expect(await readFile(path.join(p.skillDir, "SKILL.md"), "utf8")).toContain(
    "airlock-verify",
  );
  await uninstallSelfVerifySkill(p);
  expect(await isSelfVerifySkillInstalled(p)).toBe(false);
});

it("uninstall never deletes a foreign skill sharing the dir name", async () => {
  await installSelfVerifySkill(p);
  await writeFile(path.join(p.skillDir, "SKILL.md"), "name: someone-else\n");
  await uninstallSelfVerifySkill(p);
  expect(await readFile(path.join(p.skillDir, "SKILL.md"), "utf8")).toContain(
    "someone-else",
  );
});
