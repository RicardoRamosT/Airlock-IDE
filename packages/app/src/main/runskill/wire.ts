import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import {
  installRunSkill,
  type RunSkillPaths,
  uninstallRunSkill,
} from "./install";

// Resolve the shipped skill source (packaged resourcesPath vs repo resources/ in
// dev) + the install target under ~/.claude/skills. Matches quota/wire.ts's exact
// packaged/dev resolution: process.resourcesPath when packaged, __dirname-relative
// otherwise (out/main -> ../../resources).
function runSkillPaths(): RunSkillPaths {
  const skillMd = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "claude-skills",
        "airlock-run-app",
        "SKILL.md",
      )
    : path.join(
        __dirname,
        "../../resources/claude-skills/airlock-run-app/SKILL.md",
      );
  return {
    source: skillMd,
    skillDir: path.join(os.homedir(), ".claude", "skills", "airlock-run-app"),
  };
}

// Serialize reconciles so two fast pref toggles cannot race on the same fs state
// (PB-H13-class; same pattern as reconcileQuotaMeter). Never rejects.
let queue: Promise<void> = Promise.resolve();

export function reconcileRunSkill(enabled: boolean): Promise<void> {
  const run = queue.then(() => reconcileNow(enabled));
  // Keep a non-rejecting tail so a failed reconcile can't wedge the queue.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function reconcileNow(enabled: boolean): Promise<void> {
  const p = runSkillPaths();
  if (enabled) {
    if (!existsSync(p.source)) return; // resource missing (mispackage) -> skip, never throw
    await installRunSkill(p);
  } else {
    await uninstallRunSkill(p);
  }
}
