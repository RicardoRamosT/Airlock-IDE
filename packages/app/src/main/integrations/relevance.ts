// packages/app/src/main/integrations/relevance.ts
import type { RelevanceContext } from "@airlock/agent-core";

// Gather what isRelevant needs about a project: the NAMES of its vaulted
// secrets (names only -- no keychain values, so no unlock prompt) and the
// entries in its root directory.
//
// Extracted from the inline gathering in the integrations:steady handler so
// the project-scoped branch of integrations:resources shares ONE
// implementation with it, rather than growing a second copy that could drift
// into a different answer for the same project. The readers are injected --
// the real ones are agent-core's `listSecrets` and node's `readdir`, both of
// which drag the whole main-process module graph (including a native keyring
// binding) into anything that imports them -- which keeps this unit-testable
// per the repo convention of testing pure modules and leaving the wiring thin.
export async function relevanceContextFor(
  root: string,
  readSecretNames: (root: string) => Promise<string[]>,
  readRootFiles: (root: string) => Promise<string[]>,
  readOptedIn: (root: string) => Promise<string[]>,
): Promise<RelevanceContext> {
  const secretNames = await readSecretNames(root);
  let rootFiles: string[] = [];
  try {
    rootFiles = await readRootFiles(root);
  } catch {
    // unreadable root (deleted/permissions): fall back to no file signal
  }
  return { secretNames, rootFiles, optedIn: await readOptedIn(root) };
}

// The extension ids this project explicitly opted into
// (`extensions.<id>.useHere === true` in .airlock/config.json). Strictly
// `=== true`: a JSON file a user can hand-edit will eventually contain
// "true", 1, or null, and only the real boolean should turn a section on.
export function optedInExtensions(
  extensions: Record<string, Record<string, unknown>> | undefined,
): string[] {
  return Object.entries(extensions ?? {})
    .filter(([, cfg]) => cfg?.useHere === true)
    .map(([id]) => id);
}
