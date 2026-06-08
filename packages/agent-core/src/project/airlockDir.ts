import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Dropped into every project's .airlock/ dir. "*" ignores EVERYTHING in the dir
// (including this .gitignore itself), so the vault's names index, audit chain,
// and config never appear in `git status` and cannot be accidentally committed
// (e.g. by a casual `git add .`). Secret VALUES live in the OS keychain, never
// in any file here -- this guards the metadata. ASCII only (agent-core is
// CJS-bundled into the Electron main process).
const VAULT_GITIGNORE = `# AirLock vault -- do not commit. Secret values live in the OS keychain, not
# here; the names index, audit chain, and config are still private to you.
# AirLock writes this file automatically.
*
`;

// Ensure <root>/.airlock exists AND carries the ignore-all .gitignore. The
// .gitignore is written once (only when absent) so a user edit is never
// clobbered; the write is best-effort -- a failure must never block the vault
// operation that called this. Returns the .airlock dir path.
export async function ensureAirlockDir(root: string): Promise<string> {
  const dir = path.join(root, ".airlock");
  await mkdir(dir, { recursive: true });
  const gitignore = path.join(dir, ".gitignore");
  try {
    await access(gitignore);
  } catch {
    // Absent -> write it. Owner-only, like the other vault files. Swallow write
    // errors: the protection is best-effort and must not break a secret/config
    // /audit write.
    try {
      await writeFile(gitignore, VAULT_GITIGNORE, {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      // best-effort
    }
  }
  return dir;
}
