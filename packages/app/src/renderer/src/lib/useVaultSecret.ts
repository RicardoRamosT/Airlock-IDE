import { useCallback, useState } from "react";
import { useApp } from "../store";
import { restartActiveTerminal } from "./restartActiveTerminal";

// THE one validate-and-save path for vaulting a secret. Three surfaces call it --
// the agent-request corner card, the notification-bell panel, and SecretModal --
// so there is a single implementation of "write to the keychain, refresh the
// list, and get the value into running shells" rather than three that can drift.
//
// The VALUE goes user -> keychain via secretsSet and never anywhere else; this
// hook returns only an outcome.

export interface VaultSaveResult {
  ok: boolean;
  /** Saved, but the value looks unusual for this name. Not a failure. */
  warning?: string;
  error?: string;
}

export function useVaultSecret(): {
  save: (root: string, name: string, value: string) => Promise<VaultSaveResult>;
  busy: boolean;
} {
  const setSecrets = useApp((s) => s.setSecrets);
  const config = useApp((s) => s.config);
  const [busy, setBusy] = useState(false);

  const save = useCallback(
    async (
      root: string,
      name: string,
      value: string,
    ): Promise<VaultSaveResult> => {
      setBusy(true);
      try {
        const meta = await window.airlock.secretsSet(root, name.trim(), value);
        // secretsSet RESOLVED, so the keychain write happened -- refresh the list
        // even when the value looks unusual, because it IS vaulted now.
        setSecrets(await window.airlock.secretsList(root));
        // A newly vaulted secret only reaches a shell on spawn, so replace the
        // active terminal when injection is on.
        if (config?.injectSecretsIntoTerminal) restartActiveTerminal();
        return meta.valid
          ? { ok: true }
          : {
              ok: true,
              warning:
                "Saved, but the value looks unusual for this name. Check the provider hint.",
            };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        setBusy(false);
      }
    },
    [setSecrets, config],
  );

  return { save, busy };
}
