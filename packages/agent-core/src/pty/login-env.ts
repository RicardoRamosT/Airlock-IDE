import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * The user's login shell from the passwd database (NOT process.env.SHELL,
 * which is empty when the app is launched from Finder under launchd).
 */
export function loginShell(): string {
  try {
    const shell = userInfo().shell;
    if (shell && shell.length > 0) return shell;
  } catch {
    // userInfo can throw on exotic setups; fall through.
  }
  return process.env.SHELL ?? "/bin/zsh";
}

/**
 * Capture the environment a real login+interactive shell would have, by
 * running it once and dumping env. Finder-launched apps inherit launchd's
 * impoverished env (no homebrew PATH, no LANG); this recovers the user's
 * actual PATH, locale, etc. Returns a delta to layer over process.env.
 * Best-effort: on any failure returns {} so the caller falls back to
 * process.env unchanged.
 */
export async function captureLoginEnv(): Promise<Record<string, string>> {
  const shell = loginShell();
  try {
    // -i -l -c with a unique delimiter so we can parse robustly. `env -0`
    // would be ideal but not all shells expose it; use newline-split and
    // accept that values with embedded newlines are rare in env.
    const { stdout } = await exec(shell, ["-ilc", "env"], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const out: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      out[key] = line.slice(eq + 1);
    }
    return out;
  } catch {
    return {};
  }
}
