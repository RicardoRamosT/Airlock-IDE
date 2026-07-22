import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import {
  installSelfVerifySkill,
  type SelfVerifyPaths,
  uninstallSelfVerifySkill,
} from "./install";

// Resolve the shipped skill source (packaged resourcesPath vs repo resources/ in
// dev) + the install target under ~/.claude/skills. Matches runskill/wire.ts.
function selfVerifyPaths(): SelfVerifyPaths {
  const skillMd = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "claude-skills",
        "airlock-verify",
        "SKILL.md",
      )
    : path.join(
        __dirname,
        "../../resources/claude-skills/airlock-verify/SKILL.md",
      );
  return {
    source: skillMd,
    skillDir: path.join(os.homedir(), ".claude", "skills", "airlock-verify"),
  };
}

// Serialize reconciles so two fast pref toggles cannot race on the same fs state
// (PB-H13-class; same pattern as reconcileRunSkill). Never rejects.
let queue: Promise<void> = Promise.resolve();

export function reconcileSelfVerify(enabled: boolean): Promise<void> {
  const run = queue.then(() => reconcileNow(enabled));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function reconcileNow(enabled: boolean): Promise<void> {
  const p = selfVerifyPaths();
  if (enabled) {
    if (!existsSync(p.source)) return; // resource missing (mispackage) -> skip, never throw
    await installSelfVerifySkill(p);
  } else {
    await uninstallSelfVerifySkill(p);
  }
}
