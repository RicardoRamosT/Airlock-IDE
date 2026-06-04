/**
 * Env names that change process loading or binary resolution. A vaulted
 * "secret" with one of these names could hijack every child process, so
 * the spawn site strips them from injection (the user can still set them
 * in their shell profile - this guards the injection path only).
 */
const EXACT = new Set([
  "PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "SHELL",
  "HOME",
  "TMPDIR",
  "ELECTRON_RUN_AS_NODE",
]);

const PREFIXES = ["DYLD_", "LD_"];

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
