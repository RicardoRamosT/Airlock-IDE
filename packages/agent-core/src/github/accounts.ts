import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface GhAccount {
  host: string;
  username: string;
  active: boolean;
}

/**
 * Parse `gh auth status` output. Format (gh 2.x), per host then per account:
 *   github.com
 *     <glyph> Logged in to github.com account NAME (keyring)
 *     - Active account: true|false
 *     ...
 * Glyph-independent: we key off "Logged in to <host> account <name>" and
 * "Active account: true". Multiple hosts and multiple accounts supported.
 */
export function parseGhAuthStatus(raw: string): GhAccount[] {
  const accounts: GhAccount[] = [];
  const lines = raw.split(/\r?\n/);
  let pending: { host: string; username: string } | null = null;
  const flush = (active: boolean) => {
    if (pending) {
      accounts.push({ host: pending.host, username: pending.username, active });
      pending = null;
    }
  };
  for (const line of lines) {
    const m = line.match(/Logged in to (\S+) account (\S+)/);
    if (m?.[1] && m[2]) {
      // A new account block begins; if a previous one had no explicit Active
      // line (older gh), default it to false before starting the next.
      flush(false);
      pending = { host: m[1], username: m[2] };
      continue;
    }
    const a = line.match(/Active account:\s*(true|false)/i);
    if (a && pending) {
      flush(a[1]?.toLowerCase() === "true");
    }
  }
  flush(false);
  return accounts;
}

export type GhRunner = (args: string[]) => Promise<string>;

const realGh: GhRunner = async (args) => {
  const { stdout } = await exec("gh", args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
};

export interface GhStatus {
  installed: boolean;
  accounts: GhAccount[];
}

/** List logged-in GitHub accounts. installed:false if gh is absent. */
export async function ghAccounts(run: GhRunner = realGh): Promise<GhStatus> {
  try {
    // Verified gh 2.87.3: `gh auth status` writes to STDOUT (exit 0), so the
    // real runner's stdout is the happy path. Older versions may emit to
    // stderr on nonzero exit; the catch block below recovers that text.
    const out = await run(["auth", "status"]);
    return { installed: true, accounts: parseGhAuthStatus(out) };
  } catch (err) {
    const e = err as { code?: string; stderr?: string; stdout?: string };
    if (e.code === "ENOENT") return { installed: false, accounts: [] };
    // gh present but not logged in (nonzero exit): parse whatever it emitted
    // on either stream so status is captured regardless of gh version.
    const text = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    return { installed: true, accounts: parseGhAuthStatus(text) };
  }
}

/** Switch the active account for a host (non-interactive). */
export async function switchGhAccount(
  host: string,
  username: string,
  run: GhRunner = realGh,
): Promise<void> {
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^[A-Za-z0-9-]+$/.test(username)) {
    throw new Error("Invalid host or username");
  }
  await run(["auth", "switch", "--hostname", host, "--user", username]);
}
