import { useCallback, useEffect, useState } from "react";
import { formatEnvImportSummary } from "../lib/envImportSummary";
import { useProjectTab } from "../lib/projectPane";
import { restartActiveTerminal } from "../lib/restartActiveTerminal";
import { useApp } from "../store";

export function SecretsSection() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const secrets = useApp((s) => s.tabState[tabId]?.secrets ?? []);
  const config = useApp((s) => s.tabState[tabId]?.config ?? null);
  const setSecrets = useApp((s) => s.setSecrets);
  const setConfig = useApp((s) => s.setConfig);
  const setModal = useApp((s) => s.setModal); // app-global -- NOT scoped to a tab
  const clipboardClearSeconds = useApp((s) => s.clipboardClearSeconds);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  // The open row-actions menu (one at a time), anchored under its "..."
  // button: fixed position from the button's rect, right-aligned via CSS
  // transform at render. null = closed.
  const [menu, setMenu] = useState<{
    name: string;
    x: number;
    y: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!root) return;
    setSecrets(await window.airlock.secretsList(root), tabId);
    setConfig(await window.airlock.configGet(root), tabId);
    // A refreshed list may drop or change secrets; clear inline reveals so a
    // stale plaintext value can never linger next to a renamed/removed row.
    setRevealed({});
  }, [root, setSecrets, setConfig, tabId]);

  useEffect(() => {
    if (root) refresh().catch(console.error);
  }, [root, refresh]);

  // Drop inline reveals whenever the secrets META changes. An UPDATE via the
  // modal calls the store's setSecrets directly (bypassing refresh()), so without
  // this a revealed value would linger as STALE plaintext next to the now-changed
  // secret. The functional updater no-ops when already empty, so a transient
  // new-array selector result (the `?? []` fallback before the list loads) cannot
  // loop. (audit PB-H12)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `secrets` is the intentional change-trigger (clear reveals when the meta changes), not a value read in the body -- removing it breaks the fix.
  useEffect(() => {
    setRevealed((r) => (Object.keys(r).length === 0 ? r : {}));
  }, [secrets]);

  // Refresh when secrets change MAIN-side (the agent's import_env MCP tool):
  // main broadcasts secrets:changed with the project root it imported into.
  // Same post-import behavior as the button: refetch + offer a restart so
  // injected terminals can pick the new values up.
  useEffect(() => {
    if (!root) return;
    return window.airlock.onSecretsChanged((changedRoot) => {
      if (changedRoot !== root) return;
      refresh().catch(console.error);
      setNeedsRestart(true);
    });
  }, [root, refresh]);

  // Escape closes the open row menu (same shape as FileTree's menu effect).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  if (!root) return <div className="section-note">open a folder first</div>;

  const toggleInject = async () => {
    const next = await window.airlock.configSet(root, {
      injectSecretsIntoTerminal: !(config?.injectSecretsIntoTerminal ?? false),
    });
    setConfig(next, tabId);
    setNeedsRestart(true);
  };

  const removeSecret = async (name: string) => {
    await window.airlock.secretsDelete(root, name);
    await refresh();
    if (config?.injectSecretsIntoTerminal) setNeedsRestart(true);
  };

  // Reveal pulls the plaintext only on click (never on list render); a second
  // click hides it again by dropping the entry from the reveal map.
  const toggleReveal = async (name: string) => {
    if (revealed[name] !== undefined) {
      setRevealed((r) => {
        const next = { ...r };
        delete next[name];
        return next;
      });
      return;
    }
    const value = await window.airlock.secretsReveal(root, name);
    setRevealed((r) => ({ ...r, [name]: value ?? "(not found)" }));
  };

  // Copy goes by name through main, so the value never enters the renderer.
  // Main auto-clears the clipboard after clipboardClearSeconds; show a brief
  // confirmation noting that delay.
  const copyValue = async (name: string) => {
    if (!root) return;
    const res = await window.airlock.clipboardCopySecret(root, name);
    if (res.copied) {
      setCopied(name);
      setTimeout(() => setCopied((c) => (c === name ? null : c)), 2500);
    }
  };

  const importEnv = async () => {
    if (!root) return;
    try {
      const results = await window.airlock.secretsImportEnv(root, true);
      await refresh();
      const imported = results.reduce(
        (n, r) => n + (r.result?.imported.length ?? 0),
        0,
      );
      if (imported > 0) setNeedsRestart(true);
      setImportMsg(formatEnvImportSummary(results));
    } catch (err) {
      setImportMsg(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div className="secrets">
      {secrets.map((s) => (
        <div key={s.name}>
          <div className="secret-row">
            <i className="codicon codicon-key" />
            <button
              type="button"
              className="secret-name"
              title="Update value"
              onClick={() => setModal({ update: s.name })}
            >
              {s.name}
            </button>
            {s.provider && (
              <span className="badge dim-badge">{s.provider}</span>
            )}
            {!s.valid && <span className="badge">check</span>}
            <button
              type="button"
              className="row-action"
              title="Secret actions"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                // Re-clicking the same row's "..." toggles the menu closed.
                setMenu(
                  menu?.name === s.name
                    ? null
                    : { name: s.name, x: r.right, y: r.bottom + 4 },
                );
              }}
            >
              <i className="codicon codicon-ellipsis" />
            </button>
          </div>
          {revealed[s.name] !== undefined && (
            <div className="secret-reveal">{revealed[s.name]}</div>
          )}
          {copied === s.name && (
            <div className="secret-copied">
              Copied — clears from clipboard
              {clipboardClearSeconds > 0
                ? ` in ${clipboardClearSeconds}s`
                : " disabled (set in Settings)"}
            </div>
          )}
        </div>
      ))}
      {menu && (
        <>
          <button
            type="button"
            className="popover-backdrop"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
          />
          <div
            className="context-menu"
            style={{
              left: menu.x,
              top: menu.y,
              transform: "translateX(-100%)",
            }}
          >
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                void toggleReveal(menu.name);
                setMenu(null);
              }}
            >
              <span>
                {revealed[menu.name] !== undefined
                  ? "Hide value"
                  : "Reveal value"}
              </span>
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                void copyValue(menu.name);
                setMenu(null);
              }}
            >
              <span>Copy value</span>
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setModal({ update: menu.name });
                setMenu(null);
              }}
            >
              <span>Update value…</span>
            </button>
            <button
              type="button"
              className="menu-item danger"
              onClick={() => {
                void removeSecret(menu.name);
                setMenu(null);
              }}
            >
              <span>Delete</span>
            </button>
          </div>
        </>
      )}
      <div className="section-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => setModal("add-secret")}
        >
          + Add
        </button>
        <button
          type="button"
          className="btn"
          onClick={importEnv}
          title="Vault all .env files (except templates), then delete them"
        >
          Import .env
        </button>
      </div>
      {importMsg && <div className="section-note">{importMsg}</div>}
      <label
        className="inject-toggle"
        title="New terminals in this project start with these secrets as environment variables — everything run there (including Claude) can read them"
      >
        <input
          type="checkbox"
          checked={config?.injectSecretsIntoTerminal ?? false}
          onChange={toggleInject}
        />
        Make available in terminals
      </label>
      {needsRestart && (
        <button
          type="button"
          className="restart-hint"
          onClick={() => {
            // Other running terminals keep their old env (env applies at
            // spawn); only THIS pane's active shell is replaced so the user
            // lands in an injected one.
            restartActiveTerminal(tabId);
            setNeedsRestart(false);
          }}
        >
          ↻ new terminals get secrets — restart active
        </button>
      )}
    </div>
  );
}
