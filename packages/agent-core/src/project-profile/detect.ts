import {
  type CatalogEntry,
  CONFIG_CATALOG,
  DEP_CATALOG,
  LOCKFILE_CATALOG,
  MANIFEST_CATALOG,
  SECRET_CATALOG,
} from "./catalog";
import {
  type ProjectArea,
  type ProjectProfile,
  type ProjectTech,
  SERVICE_CATEGORIES,
} from "./types";

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface DetectInputs {
  root: string;
  pkg: PackageJsonLike | null;
  lockfiles: string[]; // present lockfile basenames
  configFiles: string[]; // present top-level config-file basenames
  otherManifests: string[]; // present non-JS manifest basenames
  secretNames: string[]; // VAULTED secret names
  // KEY NAMES from the project's root .env files -- never values.
  //
  // Without this the detector only ever saw npm dependencies, a handful of
  // filenames, and secrets already imported into the vault. A Python service
  // deployed to Azure Container Apps, configured entirely through a .env full
  // of AZURE_* keys, was invisible: no @azure/* dependency, no azure.yaml,
  // nothing vaulted. SECRET_CATALOG already had the patterns; nothing fed them.
  envFileNames: string[];
  workspaces: string[] | null; // monorepo workspace dirs, or null
  topLevelDirs: string[];
  integrationsDetected: string[]; // v1: [] (reserved for the live integration registry)
  generatedAt: number;
}

interface Hit {
  entry: CatalogEntry;
  source: string;
  version?: string;
}

export function buildProfile(i: DetectInputs): ProjectProfile {
  const hits: Hit[] = [];

  const deps = {
    ...(i.pkg?.dependencies ?? {}),
    ...(i.pkg?.devDependencies ?? {}),
  };
  for (const [name, version] of Object.entries(deps)) {
    const entry = DEP_CATALOG[name];
    if (entry) hits.push({ entry, source: "package.json", version });
  }
  for (const file of i.configFiles) {
    const entry = CONFIG_CATALOG[file];
    if (entry) hits.push({ entry, source: file });
  }
  for (const file of i.otherManifests) {
    const entry = MANIFEST_CATALOG[file];
    if (entry) hits.push({ entry, source: file });
  }
  for (const file of i.lockfiles) {
    const entry = LOCKFILE_CATALOG[file];
    if (entry) hits.push({ entry, source: file });
  }
  for (const name of i.secretNames) {
    const match = SECRET_CATALOG.find((s) => s.test.test(name));
    if (match) hits.push({ entry: match.entry, source: `secret: ${name}` });
  }
  // Labelled ".env: NAME", not "secret: NAME": these are not vaulted, and
  // project_info reports the signal that found each tech.
  for (const name of i.envFileNames) {
    const match = SECRET_CATALOG.find((s) => s.test.test(name));
    if (match) hits.push({ entry: match.entry, source: `.env: ${name}` });
  }

  const byId = new Map<string, ProjectTech>();
  for (const h of hits) {
    const existing = byId.get(h.entry.id);
    if (existing) {
      if (!existing.sources.includes(h.source)) existing.sources.push(h.source);
      if (existing.version === undefined && h.version !== undefined)
        existing.version = h.version;
    } else {
      byId.set(h.entry.id, {
        id: h.entry.id,
        name: h.entry.name,
        category: h.entry.category,
        ...(h.version !== undefined ? { version: h.version } : {}),
        sources: [h.source],
      });
    }
  }

  const all = [...byId.values()].sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
  const techs = all.filter((t) => !SERVICE_CATEGORIES.has(t.category));
  const services = all.filter((t) => SERVICE_CATEGORIES.has(t.category));

  const areaDirs = i.workspaces?.length ? i.workspaces : i.topLevelDirs;
  const areas: ProjectArea[] = areaDirs.map((d) => ({ name: d, path: d }));

  return { root: i.root, techs, services, areas, generatedAt: i.generatedAt };
}
