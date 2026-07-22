// Pure helpers for the LOCAL dev self-update channel (AirLock dev builds only).
// No I/O: callers read/write files and pass plain data in. See the design spec
// 2026-07-22-local-dev-self-update-design.md.

export interface DevManifest {
  appPath: string; // absolute path to the freshly built AirLock.app
  version: string; // display label, e.g. "0.5.0"
  builtAt: number; // epoch ms when the dev build was produced
}

// Parse <userData>/dev-update.json. Returns null for anything malformed so
// callers fall back to the GitHub update path.
export function parseDevManifest(json: unknown): DevManifest | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const { appPath, version, builtAt } = o;
  if (typeof appPath !== "string" || appPath === "") return null;
  if (typeof version !== "string" || version === "") return null;
  if (typeof builtAt !== "number" || !Number.isFinite(builtAt) || builtAt <= 0)
    return null;
  return { appPath, version, builtAt };
}

// A local dev build supersedes the running one iff it was built later.
export function isLocalBuildNewer(
  localBuiltAt: number,
  runningBuiltAt: number,
): boolean {
  return localBuiltAt > runningBuiltAt;
}

export type UpdateSource =
  | { kind: "local"; appPath: string }
  | { kind: "dmg"; url: string };

// Where applyUpdate() should get the new bundle. Local (dev channel) wins; then
// the GitHub DMG; else null (nothing to apply).
export function pickUpdateSource(u: {
  localAppPath?: string | null;
  dmgUrl?: string | null;
}): UpdateSource | null {
  if (u.localAppPath) return { kind: "local", appPath: u.localAppPath };
  if (u.dmgUrl) return { kind: "dmg", url: u.dmgUrl };
  return null;
}
