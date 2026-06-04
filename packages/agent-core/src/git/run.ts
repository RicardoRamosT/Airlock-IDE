import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Run git with an argv array (never a shell - no injection surface) in the
 * given workspace root. Throws an Error carrying stderr on nonzero exit.
 */
export async function runGit(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
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
