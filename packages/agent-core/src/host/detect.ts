import type { PortProber } from "./probe";

// Subdirectories where a frontend's package.json typically lives, in priority
// order ("" = the repo root itself). A backend repo commonly keeps its web app
// under frontend/ or web/, so the root alone is not enough to find it.
export const FRONTEND_SUBDIRS = ["", "frontend", "web", "client", "app", "ui"];

// Common dev-server ports to scan when nothing is configured/guessable, in
// rough priority order (browsable frontend dev servers first, then app/backend
// ports). Used as the fallback so a running server is detected regardless of
// language or project layout.
export const COMMON_DEV_PORTS = [
  5173, 5174, 3000, 3001, 4321, 4200, 8080, 8000, 5000,
];

// Guess a dev-server port from ONE package.json's contents: an explicit
// --port flag in any script wins, else the framework default by dependency.
// Returns null when nothing recognizable (or the content is not JSON). Pure.
export function guessDevPort(pkgJsonContent: string): number | null {
  let pkg: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(pkgJsonContent);
  } catch {
    return null;
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scriptText = Object.values(pkg.scripts ?? {}).join(" ");
  const portMatch = scriptText.match(/--port[ =](\d{2,5})/);
  if (portMatch) return Number(portMatch[1]);
  if (deps.next) return 3000;
  if (deps.vite || deps["@vitejs/plugin-react"]) return 5173;
  if (deps["react-scripts"]) return 3000;
  if (deps.astro) return 4321;
  return null;
}

// Pick the dev port to surface by PROBING: prefer a guessed port that is
// actually listening, else the first listening common dev port. Candidates are
// tried in priority order (guessed first, then common; deduped) but probed
// concurrently. Returns null when none are up -- so a guessed-but-down port is
// never shown. Pure given the injected prober.
export async function pickListeningPort(
  guessed: number[],
  probe: PortProber,
  commonPorts: number[] = COMMON_DEV_PORTS,
): Promise<number | null> {
  const seen = new Set<number>();
  const candidates: number[] = [];
  for (const p of [...guessed, ...commonPorts]) {
    if (!seen.has(p)) {
      seen.add(p);
      candidates.push(p);
    }
  }
  const up = await Promise.all(candidates.map((p) => probe("localhost", p)));
  const i = up.findIndex(Boolean);
  // i === -1 -> candidates[-1] is undefined -> null; ports are never 0.
  return candidates[i] ?? null;
}
