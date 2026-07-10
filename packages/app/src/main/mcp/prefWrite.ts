// packages/app/src/main/mcp/prefWrite.ts
// The write half of the self-verification toolkit: a hard allow-list of app-global
// prefs the agent may set (never security prefs), plus the apply+reconcile path.
import { loadPrefs, savePrefs } from "../prefs";
import { reconcileQuotaMeter } from "../quota/wire";
import { reconcileRunSkill } from "../runskill/wire";

// Benign UI/feature toggles only. Deliberately EXCLUDES agentPolicy (would let
// the agent unlock its own run_command gate), selfVerify (only a human arms the
// toolkit), and eventLog (must not blind the error log it's verified through).
// NOTE: `dockStatus` joins this list when the dock-status feature lands on main.
const SETTABLE = new Set<string>([
  "quotaMeter",
  "runAppSkill",
  "theme",
  "sectionVisibility",
  "openProjectsAsTabs",
  "claudeAutoStart",
  "defaultTerminal",
  "restoreSession",
  "clipboardClearSeconds",
]);

export function isSettablePref(key: string): boolean {
  return SETTABLE.has(key);
}

// Validate the key against the allow-list, persist the patch (savePrefs merges),
// then run the one main-side reconcile the changed key needs (bad values are
// sanitized on reload). Never touches a refused key.
export async function applyPrefPatch(
  prefsFile: string,
  key: string,
  value: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSettablePref(key)) {
    return {
      ok: false,
      error: `"${key}" is not a settable preference. Allowed: ${[...SETTABLE].join(", ")}.`,
    };
  }
  await savePrefs(prefsFile, { [key]: value } as never);
  const prefs = await loadPrefs(prefsFile);
  if (key === "quotaMeter") await reconcileQuotaMeter(prefs.quotaMeter.enabled);
  else if (key === "runAppSkill")
    await reconcileRunSkill(prefs.runAppSkill.enabled);
  return { ok: true };
}
