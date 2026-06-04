import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ProjectConfig {
  injectSecretsIntoTerminal: boolean;
}

const DEFAULTS: ProjectConfig = { injectSecretsIntoTerminal: false };

function configFile(root: string): string {
  return path.join(root, ".airlock", "config.json");
}

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  try {
    const text = await readFile(configFile(root), "utf8");
    return { ...DEFAULTS, ...(JSON.parse(text) as Partial<ProjectConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeProjectConfig(
  root: string,
  patch: Partial<ProjectConfig>,
): Promise<ProjectConfig> {
  const next = { ...(await readProjectConfig(root)), ...patch };
  await mkdir(path.dirname(configFile(root)), { recursive: true });
  await writeFile(
    configFile(root),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
  return next;
}
