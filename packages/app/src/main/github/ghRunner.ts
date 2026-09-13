// ASCII comments only. Run `gh` as THIS PROJECT's account.
//
// gh has one globally active account. A project pinned to a different one gets
// a 404 that looks exactly like an empty result:
//
//   $ gh pr list --state all
//   GraphQL: Could not resolve to a Repository with the name
//   'RicardoRamosT/ElArqui'. (repository)
//
// ciStatus.ts degrades a failed gh call to "no CI to report", so until now that
// 404 rendered as a missing CI row -- indistinguishable from green. Every gh
// read in the app should go through here.
//
// The token goes in the child's ENV. argv is world-readable via `ps`, so a
// token there is a credential leak to every process on the machine.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type GhRunner, readProjectConfig } from "@airlock/agent-core";

const exec = promisify(execFile);

export interface PinnedGh {
  run: GhRunner;
  account: string | null; // the pinned account actually in force, else null
  degraded: string | null; // why we are NOT running as the pin, if we are not
}

export interface GhRunnerDeps {
  readPin(root: string): Promise<string | null>;
  token(user: string): Promise<string>;
  exec(
    args: string[],
    cwd: string | undefined,
    env: NodeJS.ProcessEnv,
  ): Promise<string>;
}

const realDeps: GhRunnerDeps = {
  readPin: async (root) =>
    (await readProjectConfig(root)).githubAccount?.username ?? null,
  token: async (user) => {
    const { stdout } = await exec("gh", ["auth", "token", "--user", user], {
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  },
  exec: async (args, cwd, env) => {
    // cwd MUST be the repo root: gh resolves the target repo from the working
    // directory, and the packaged app's process cwd is not the project.
    const { stdout } = await exec("gh", args, {
      cwd,
      env,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  },
};

export async function ghRunnerFor(
  root: string,
  deps: GhRunnerDeps = realDeps,
): Promise<PinnedGh> {
  let pin: string | null = null;
  try {
    pin = await deps.readPin(root);
  } catch {
    pin = null; // no config, unreadable config -> unpinned, which is not a fault
  }
  if (!pin) {
    return {
      run: (args, cwd) => deps.exec(args, cwd, process.env),
      account: null,
      degraded: null,
    };
  }
  try {
    const token = await deps.token(pin);
    if (!token) throw new Error("empty token");
    const env = { ...process.env, GH_TOKEN: token };
    return {
      run: (args, cwd) => deps.exec(args, cwd, env),
      account: pin,
      degraded: null,
    };
  } catch {
    // The error is deliberately NOT interpolated: `gh auth token` echoes the
    // token on some failure paths and this string reaches the debrief.
    return {
      run: (args, cwd) => deps.exec(args, cwd, process.env),
      account: null,
      degraded: `pinned to ${pin} but its gh token could not be read; ran as the active account`,
    };
  }
}
