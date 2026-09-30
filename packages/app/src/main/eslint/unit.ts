// unit.ts -- which ESLint config governs a file, decided by stat alone.
//
// Nothing here reads or executes a repo file: it runs BEFORE the user has
// trusted the folder, so a config is only ever looked AT, never loaded.
// `exists` takes ROOT-RELATIVE paths, so no answer can name a directory above
// the project root.
//
// The unit is the NEAREST config, not the project root: several projects keep
// ESLint in a subfolder with its own install (frontend/, or both client/ and
// server/), and each runs different code, so each is trusted separately.
const LINTABLE = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
]);

// Flat config only. Every project surveyed (2026-09-30) is on ESLint 9/10 flat
// config; legacy .eslintrc is out of scope, so a file under one is not linted.
export const ESLINT_CONFIG_NAMES: readonly string[] = [
  "js",
  "mjs",
  "cjs",
  "ts",
  "mts",
  "cts",
].map((e) => `eslint.config.${e}`);

export function isLintablePath(relPath: string): boolean {
  const name = relPath.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 && LINTABLE.has(name.slice(dot + 1).toLowerCase());
}

function join(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

// A root-relative dir and each of its ancestors, nearest first, ending at "".
function ancestors(dir: string): string[] {
  const parts = dir ? dir.split("/") : [];
  const out: string[] = [];
  for (let i = parts.length; i >= 0; i--) out.push(parts.slice(0, i).join("/"));
  return out;
}

// Root-relative dir of the nearest config at or above the file ("" = the root),
// or null when none governs it.
export function findEslintUnit(
  relPath: string,
  exists: (rel: string) => boolean,
): string | null {
  const dir = relPath.split("/").slice(0, -1).join("/");
  for (const d of ancestors(dir))
    if (ESLINT_CONFIG_NAMES.some((n) => exists(join(d, n)))) return d;
  return null;
}

// Is ESLint installed where Node's resolution would find it from the unit: the
// unit's own node_modules or any ancestor's, up to and including the root (a
// hoisted monorepo install counts), never above it.
export function eslintInstalled(
  unitRel: string,
  exists: (rel: string) => boolean,
): boolean {
  return ancestors(unitRel).some((d) =>
    exists(join(d, "node_modules/eslint/package.json")),
  );
}
