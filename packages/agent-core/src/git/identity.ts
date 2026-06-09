import { runGit } from "./run";

export interface GitIdentity {
  name: string;
  email: string;
}

type GitRun = (root: string, args: string[]) => Promise<string>;

// Set the repo-local user.name/user.email to `identity`, but only the fields
// that differ (idempotent; no needless writes). Reading a missing key throws in
// git, so treat that as "".
export async function ensureCommitIdentity(
  root: string,
  identity: GitIdentity,
  run: GitRun = runGit,
): Promise<void> {
  const read = async (key: string): Promise<string> => {
    try {
      return (await run(root, ["config", "--local", key])).trim();
    } catch {
      return "";
    }
  };
  if ((await read("user.name")) !== identity.name) {
    await run(root, ["config", "--local", "user.name", identity.name]);
  }
  if ((await read("user.email")) !== identity.email) {
    await run(root, ["config", "--local", "user.email", identity.email]);
  }
}
