import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Run git with an argv array (never a shell - no injection surface) in the
 * given workspace root. Throws an Error carrying stderr on nonzero exit.
 */
// Generous: a fetch over a slow link is legitimate, a wedged git is not.
const GIT_TIMEOUT_MS = 60_000;

export async function runGit(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
      // A deadline as well as a buffer cap. git can block indefinitely on a
      // network remote or a stale index.lock, and these run on sidebar polls.
      timeout: GIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      e.stderr?.trim() || e.stdout?.trim() || e.message || "git failed",
    );
  }
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    return (
      (await runGit(root, ["rev-parse", "--is-inside-work-tree"])).trim() ===
      "true"
    );
  } catch {
    return false;
  }
}
