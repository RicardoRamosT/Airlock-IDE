/**
 * Env names that change process loading, binary resolution, or auto-execute a
 * command in a child process. A vaulted "secret" with one of these names could
 * hijack every child process (run a binary, source a startup file, preload a
 * library), so the spawn site strips them from injection and the broker rejects
 * vaulting them. This guards the injection path only -- the user can still set
 * them in their own shell profile. The list is deliberately broad: a PARTIAL
 * list is the bug (audit C6), so it covers the whole loader/command-hijack class
 * (shell startup files, git transport/diff/pager/editor hooks, and the
 * perl/python/ruby auto-load + module-path vars), not just the node/dyld subset.
 */
const EXACT = new Set([
  // path / dynamic loader / node + electron
  "PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "SHELL",
  "HOME",
  "TMPDIR",
  "ELECTRON_RUN_AS_NODE",
  // shell startup files: sourced by sh/bash/zsh on spawn -> arbitrary code
  "BASH_ENV",
  "ENV",
  "PROMPT_COMMAND",
  "ZDOTDIR",
  // git hooks that exec a command/binary on routine operations
  "GIT_SSH_COMMAND",
  "GIT_SSH",
  "GIT_EXTERNAL_DIFF",
  "GIT_PAGER",
  "GIT_EDITOR",
  // pagers/editors auto-spawned by git, man, less, crontab, ...
  "PAGER",
  "EDITOR",
  "VISUAL",
  // interpreter auto-load opts + module-path hijacks
  "PERL5OPT",
  "PERL5LIB",
  "PYTHONSTARTUP",
  "PYTHONPATH",
  "RUBYOPT",
  "RUBYLIB",
]);

// DYLD_/LD_ : dynamic-loader controls (insert/preload/path). BASH_FUNC_ :
// exported bash functions (the Shellshock vector) -- bash runs them on startup.
const PREFIXES = ["DYLD_", "LD_", "BASH_FUNC_"];

/**
 * True if `name` is one of the reserved/dangerous env names (exact set above
 * or a DYLD_/LD_ dynamic-loader prefix). Single source of truth shared by the
 * injection-time filter (filterDangerousEnv) and the store-time guard in the
 * broker, so a name that would be silently stripped at spawn is instead
 * rejected up front.
 */
export function isDangerousEnvName(name: string): boolean {
  return EXACT.has(name) || PREFIXES.some((p) => name.startsWith(p));
}

export interface DangerousEnvResult {
  safe: Record<string, string>;
  blocked: string[];
}

export function filterDangerousEnv(
  env: Record<string, string>,
): DangerousEnvResult {
  const safe: Record<string, string> = {};
  const blocked: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (isDangerousEnvName(name)) {
      blocked.push(name);
      continue;
    }
    safe[name] = value;
  }
  return { safe, blocked };
}
