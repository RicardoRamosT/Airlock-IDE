// The marker stamped into every terminal AirLock spawns, so a Claude session can
// tell it is running INSIDE AirLock (vs another IDE that merely sees AirLock's
// globally-registered MCP server). The run-app routing skill gates on this.
// Value-free; not a "dangerous" env name, so it never interacts with the secret
// injection filter.
export const AIRLOCK_ENV = { AIRLOCK_IDE: "1" } as const;

export function stampAirlockEnv(
  env: Record<string, string>,
): Record<string, string> {
  return { ...env, ...AIRLOCK_ENV };
}
