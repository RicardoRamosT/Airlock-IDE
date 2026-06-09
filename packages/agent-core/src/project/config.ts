import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAirlockDir } from "./airlockDir";

export interface ProjectConfig {
  injectSecretsIntoTerminal: boolean;
  // Local dev-server URL for the Host section probe (e.g. http://localhost:3000).
  // Optional: undefined by default, so it is omitted from DEFAULTS. A partial
  // { devUrl } patch persists via writeProjectConfig and survives readProjectConfig.
  devUrl?: string;
  // Per-project GitHub account override for git remote ops + commit identity.
  // Absent => auto-detect from the repo's origin owner. Stores only a reference
  // (host + username), never a credential.
  githubAccount?: { host: string; username: string };
}

const DEFAULTS: ProjectConfig = { injectSecretsIntoTerminal: false };

function configFile(root: string): string {
  return path.join(root, ".airlock", "config.json");
}

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  // Distinguish an absent file (normal: return defaults silently) from a
  // malformed file (a user typo: still return defaults, but warn so the
  // ignored config is not silently hidden).
  let text: string;
  try {
    text = await readFile(configFile(root), "utf8");
  } catch {
    // Read failure (ENOENT or otherwise) means no usable config - defaults.
    return { ...DEFAULTS };
  }
  try {
    return { ...DEFAULTS, ...(JSON.parse(text) as Partial<ProjectConfig>) };
  } catch {
    console.warn("[airlock] .airlock/config.json malformed, using defaults");
    return { ...DEFAULTS };
  }
}

export async function writeProjectConfig(
  root: string,
  patch: Partial<ProjectConfig>,
): Promise<ProjectConfig> {
  const next = { ...(await readProjectConfig(root)), ...patch };
  await ensureAirlockDir(root); // create .airlock + drop the ignore-all .gitignore
  // mode 0o600: least-privilege, matching the secrets meta hardening.
  await writeFile(configFile(root), `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return next;
}
