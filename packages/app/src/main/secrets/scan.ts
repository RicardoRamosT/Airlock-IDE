// packages/app/src/main/secrets/scan.ts
// Main-side secret scan: reads staged/working content + the vault and runs the
// pure scanForSecrets, returning VALUE-FREE SecretLeak[]. The only place that
// pulls secret values into a scan. ASCII-only.
import {
  type DiffSide,
  gitFileVersions,
  gitStatus,
  scanForSecrets,
  sessionSecretEntries,
  vaultedSecrets,
} from "@airlock/agent-core";
import type { SecretLeak } from "../../shared/ipc";

const MAX_SCAN_BYTES = 1_000_000; // skip files bigger than the editor read cap

async function scanFiles(
  root: string,
  paths: string[],
  which: DiffSide,
): Promise<SecretLeak[]> {
  // Both stores: a SESSION-captured value (capture_secret) can reach staged
  // content exactly like a vaulted one -- injectSecrets into a build,
  // `printenv > file`, `docker compose config > resolved.yml` -- so the scan set
  // must cover both or a captured-but-never-vaulted credential leaks through
  // unreported. Same reasoning as the terminal-tail redactor's allVaultedValues:
  // redact/scan every known value rather than reason about which paths are
  // reachable. (audit C1/H1)
  const known = [
    ...(await vaultedSecrets(root)),
    ...sessionSecretEntries(root),
  ];
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
    for (const f of scanForSecrets(modified, known)) {
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

function dedupeLeaks(leaks: SecretLeak[]): SecretLeak[] {
  const seen = new Set<string>();
  const out: SecretLeak[] = [];
  for (const l of leaks) {
    const key = `${l.path}:${l.line}:${l.name ?? l.patternType ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

// Every not-yet-committed change the agent should know about: STAGED content
// (what a commit would persist -- the same set the commit gate scans) PLUS the
// unstaged + untracked working changes. Deduped, since a partially-staged file
// can surface on both sides. This keeps git_status's advisory consistent with
// the git_commit gate -- a staged secret shows up here, not only at commit time.
export async function scanWorkingSet(root: string): Promise<SecretLeak[]> {
  const status = await gitStatus(root);
  const staged = await scanFiles(
    root,
    status.staged.map((c) => c.path),
    "staged",
  );
  const working = await scanFiles(
    root,
    [...status.unstaged.map((c) => c.path), ...status.untracked],
    "unstaged",
  );
  return dedupeLeaks([...staged, ...working]);
}
