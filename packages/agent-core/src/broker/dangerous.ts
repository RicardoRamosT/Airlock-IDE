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
    if (EXACT.has(name) || PREFIXES.some((p) => name.startsWith(p))) {
      blocked.push(name);
      continue;
    }
    safe[name] = value;
  }
  return { safe, blocked };
}
