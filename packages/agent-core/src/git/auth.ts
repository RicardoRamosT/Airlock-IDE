import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runGit } from "./run";

const exec = promisify(execFile);

// Inline git credential helper: on a `get` request, print x-access-token + the
// token read from $AIRLOCK_GH_TOKEN. Token stays in the env, never in argv.
const CREDENTIAL_HELPER =
  '!f() { test "$1" = get && printf "username=x-access-token\\npassword=%s\\n" "$AIRLOCK_GH_TOKEN"; }; f';

// Prepend: clear inherited helpers (so gh's global helper does not also fire),
// then install ours.
export function buildAuthedArgs(args: string[]): string[] {
  return [
    "-c",
    "credential.helper=",
    "-c",
    `credential.helper=${CREDENTIAL_HELPER}`,
    ...args,
  ];
}

export type GitExec = (
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; maxBuffer: number },
) => Promise<{ stdout: string }>;

const realExec: GitExec = (args, opts) => exec("git", args, opts);

// Run a git network op authenticated as a specific account's token. With a null
// token, falls back to plain runGit (today's credential-helper behavior).
export async function runGitAuthed(
  root: string,
  token: string | null,
  args: string[],
  run: GitExec = realExec,
): Promise<string> {
  if (!token) return runGit(root, args);
  try {
    const { stdout } = await run(buildAuthedArgs(args), {
      cwd: root,
      env: { ...process.env, AIRLOCK_GH_TOKEN: token },
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
