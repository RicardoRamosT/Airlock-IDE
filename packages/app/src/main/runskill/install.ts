import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RunSkillPaths {
  source: string; // the shipped SKILL.md (resourcesPath when packaged, repo resources/ in dev)
  skillDir: string; // ~/.claude/skills/airlock-run-app
}

// Identifies OUR skill so uninstall never deletes a dir we did not create.
const OURS = "name: airlock-run-app";

function target(p: RunSkillPaths): string {
  return path.join(p.skillDir, "SKILL.md");
}

// Idempotent: write our shipped SKILL.md into <skillDir>/SKILL.md. Skips the write
// when the content is already identical (no churn).
export async function installRunSkill(p: RunSkillPaths): Promise<void> {
  const content = await readFile(p.source, "utf8");
  let existing: string | null = null;
  try {
    existing = await readFile(target(p), "utf8");
  } catch {
    existing = null;
  }
  if (existing === content) return;
  await mkdir(p.skillDir, { recursive: true });
  await writeFile(target(p), content, { encoding: "utf8", mode: 0o644 });
}

// Remove our skill dir, but ONLY when its SKILL.md is ours (marker present) — never
// clobber a foreign skill that happens to share the dir name.
export async function uninstallRunSkill(p: RunSkillPaths): Promise<void> {
  let existing: string;
  try {
    existing = await readFile(target(p), "utf8");
  } catch {
    return; // nothing installed
  }
  if (!existing.includes(OURS)) return; // not ours -> leave it
  await rm(p.skillDir, { recursive: true, force: true });
}

export async function isRunSkillInstalled(p: RunSkillPaths): Promise<boolean> {
  try {
    return (await readFile(target(p), "utf8")).includes(OURS);
  } catch {
    return false;
  }
}
