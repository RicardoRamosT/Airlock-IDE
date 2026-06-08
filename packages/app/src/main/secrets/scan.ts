// packages/app/src/main/secrets/scan.ts
// Main-side secret scan: reads staged/working content + the vault and runs the
// pure scanForSecrets, returning VALUE-FREE SecretLeak[]. The only place that
// pulls secret values into a scan. ASCII-only.
import {
  type DiffSide,
  gitFileVersions,
  gitStatus,
  scanForSecrets,
  vaultedSecrets,
} from "@airlock/agent-core";
import type { SecretLeak } from "../../shared/ipc";

const MAX_SCAN_BYTES = 1_000_000; // skip files bigger than the editor read cap

async function scanFiles(
  root: string,
  paths: string[],
  which: DiffSide,
): Promise<SecretLeak[]> {
  const vaulted = await vaultedSecrets(root);
  if (vaulted.length === 0 && which === "unstaged") {
    // patterns still apply even with an empty vault, so do not early-return;
    // this branch is only a readability marker -- fall through.
  }
  const leaks: SecretLeak[] = [];
  for (const p of paths) {
    let modified: string;
    let binary: boolean;
    try {
      const v = await gitFileVersions(root, p, which);
      modified = v.modified;
      binary = v.binary;
    } catch {
      continue; // unreadable at this ref -- skip
    }
    if (binary || modified.length > MAX_SCAN_BYTES) continue;
    for (const f of scanForSecrets(modified, vaulted)) {
      leaks.push({
        path: p,
        line: f.line,
        name: f.name,
        patternType: f.patternType,
      });
    }
  }
  return leaks;
}

// Staged content -- exactly what a commit would persist.
export async function scanStaged(root: string): Promise<SecretLeak[]> {
  const status = await gitStatus(root);
  return scanFiles(
    root,
    status.staged.map((c) => c.path),
    "staged",
  );
}

// Changed working files (modified + untracked) -- what the agent sees via status.
export async function scanWorkingSet(root: string): Promise<SecretLeak[]> {
  const status = await gitStatus(root);
  const paths = [...status.unstaged.map((c) => c.path), ...status.untracked];
  return scanFiles(root, paths, "unstaged");
}
