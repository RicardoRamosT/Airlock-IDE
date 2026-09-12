// packages/app/src/main/integrations/relevance.ts
import type { RelevanceContext } from "@airlock/agent-core";

// What relevanceContextFor needs to look up. Grouped rather than positional:
// there are five now, they are all `(root) => Promise<...>`, and a positional
// list of five same-shaped functions is one transposition away from silently
// answering a different question.
//
// The real readers drag the whole main-process module graph (including a
// native keyring binding) into anything that imports them, which is why they
// are injected and this module stays pure + unit-testable, per the repo
// convention of testing pure modules and keeping wiring thin.
export interface RelevanceReaders {
  // NAMES only -- no keychain values, so no unlock prompt.
  secretNames(root: string): Promise<string[]>;
  rootFiles(root: string): Promise<string[]>;
  optedIn(root: string): Promise<string[]>;
  // Host of the project's git origin ("github.com"), or null.
  gitRemoteHost(root: string): Promise<string | null>;
  // Extension ids already bound to THIS project.
  connectedHere(root: string): Promise<string[]>;
}

// Gather what isRelevant needs about a project.
//
// Extracted from the inline gathering in the integrations:steady handler so
// every consumer shares ONE implementation, rather than growing a second copy
// that could drift into a different answer for the same project.
export async function relevanceContextFor(
  root: string,
  r: RelevanceReaders,
): Promise<RelevanceContext> {
  const secretNames = await r.secretNames(root);
  let rootFiles: string[] = [];
  try {
    rootFiles = await r.rootFiles(root);
  } catch {
    // unreadable root (deleted/permissions): fall back to no file signal
  }
  // A missing git remote is normal (a project need not be a repo), and a
  // failure to read one must not make every OTHER signal unavailable.
  const gitRemoteHost = await r.gitRemoteHost(root).catch(() => null);
  return {
    secretNames,
    rootFiles,
    gitRemoteHost,
    connectedHere: await r.connectedHere(root).catch(() => []),
    optedIn: await r.optedIn(root),
  };
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

// The extension ids BOUND to this project, read from the same config.
//
// Being bound here is the strongest signal there is that the project uses
// something -- and for an identity it is the ONLY one available: nothing in a
// repo says "this project uses Slack". Today the binding that matters is
// Slack's VERIFIED workspace id (never workspacePin, which is only what the
// user requested); `connected: true` is accepted so a future provider that
// records a plain flag needs no change here.
export function boundExtensions(
  extensions: Record<string, Record<string, unknown>> | undefined,
): string[] {
  return Object.entries(extensions ?? {})
    .filter(([, cfg]) => {
      if (cfg?.connected === true) return true;
      const ws = cfg?.workspace as { id?: unknown } | undefined;
      return typeof ws?.id === "string" && ws.id.length > 0;
    })
    .map(([id]) => id);
}
