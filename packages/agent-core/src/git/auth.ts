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

// Persisted per-repo credential routing (git config --local) so EVERY git push
// from this repo -- terminal, agent, or GUI -- authenticates as a specific gh
// account, independent of the machine's active account. Unlike CREDENTIAL_HELPER
// above (which reads $AIRLOCK_GH_TOKEN for a single in-process op), this helper
// fetches the token itself via `gh auth token --user`, so it works in a plain
// terminal. host/username are validated so they cannot break out of the string.
export interface CredentialHelperConfig {
  set: Array<{ key: string; value: string }>; // apply in order (reset first)
  unset: string[]; // keys to remove on unpin
}

export function buildCredentialHelperConfig(
  host: string,
  username: string,
): CredentialHelperConfig {
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^[A-Za-z0-9-]+$/.test(username)) {
    throw new Error("Invalid host or username");
  }
  const scopedKey = `credential.https://${host}.helper`;
  // Fetch this account's token from gh on each `get`; print nothing otherwise.
  const helper = `!f() { test "$1" = get && printf "username=x-access-token\\npassword=%s\\n" "$(gh auth token --hostname ${host} --user ${username})"; }; f`;
  return {
    // Empty helper first RESETS the inherited list (suppresses gh's global
    // helper for this repo); the host-scoped one then serves our account.
    set: [
      { key: "credential.helper", value: "" },
      { key: scopedKey, value: helper },
    ],
    unset: ["credential.helper", scopedKey],
  };
}

// Is this repo's LOCAL credential config still the pin we installed? Two ways
// it rots, both observed in the wild (2026-08-20):
//   - our host-scoped helper is gone -- a pin written before this feature
//     existed, or `gh auth setup-git` clearing the key; or
//   - a FOREIGN helper sits in the unscoped list after our empty reset. git
//     runs the list in order and stops at the first helper that answers, so
//     gh's account-agnostic `gh auth git-credential` gets there first and
//     serves whatever account is globally ACTIVE.
// Both fail silently -- the push just goes out as the wrong user -- so callers
// reinstall rather than trusting that a pin recorded in config is a pin in
// force. An unparseable host/username is reported intact: it is not repairable
// (buildCredentialHelperConfig would reject it), so there is nothing to do.
export function credentialHelperIntact(
  local: { helper: string[]; scoped: string[] },
  host: string,
  username: string,
): boolean {
  let ours: string | undefined;
  try {
    ours = buildCredentialHelperConfig(host, username).set[1]?.value;
  } catch {
    return true;
  }
  if (!ours || !local.scoped.includes(ours)) return false;
  // Only our own empty reset may appear in the unscoped list.
  return local.helper.every((v) => v.trim() === "");
}
