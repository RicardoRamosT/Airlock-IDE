import { useCallback, useEffect, useState } from "react";
import { useApp } from "../store";

export function SecretsSection() {
  const {
    root,
    secrets,
    setSecrets,
    config,
    setConfig,
    setModal,
    restartTerminal,
  } = useApp();
  const [needsRestart, setNeedsRestart] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSecrets(await window.airlock.secretsList());
    setConfig(await window.airlock.configGet());
  }, [setSecrets, setConfig]);

  useEffect(() => {
    if (root) refresh().catch(console.error);
  }, [root, refresh]);

  if (!root) return <div className="section-note">open a folder first</div>;

  const toggleInject = async () => {
    const next = await window.airlock.configSet({
      injectSecretsIntoTerminal: !(config?.injectSecretsIntoTerminal ?? false),
    });
    setConfig(next);
    setNeedsRestart(true);
  };

  const removeSecret = async (name: string) => {
    await window.airlock.secretsDelete(name);
    await refresh();
    if (config?.injectSecretsIntoTerminal) setNeedsRestart(true);
  };

  const importEnv = async () => {
    try {
      const r = await window.airlock.secretsImportEnv(".env", true);
      await refresh();
      setNeedsRestart(true);
      setImportMsg(
        `Imported ${r.imported.length}${r.deleted ? ", .env deleted" : ""}${r.skipped.length ? `, skipped: ${r.skipped.join(", ")}` : ""}`,
      );
    } catch (err) {
      setImportMsg(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const restart = () => {
    restartTerminal();
    setNeedsRestart(false);
  };

  return (
    <div className="secrets">
      {secrets.map((s) => (
        <div key={s.name} className="secret-row">
          <button
            type="button"
            className="secret-name"
            title="Update value"
            onClick={() => setModal({ update: s.name })}
          >
            {s.name}
          </button>
          {s.provider && <span className="badge dim-badge">{s.provider}</span>}
          {!s.valid && <span className="badge">check</span>}
          <button
            type="button"
            className="secret-delete"
            title="Delete from Keychain"
            onClick={() => removeSecret(s.name)}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="secret-actions">
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
          title="Vault .env, then delete it"
        >
          Import .env
        </button>
      </div>
      {importMsg && <div className="section-note">{importMsg}</div>}
      <label
        className="inject-toggle"
        title="New terminal sessions get these as env vars"
      >
        <input
          type="checkbox"
          checked={config?.injectSecretsIntoTerminal ?? false}
          onChange={toggleInject}
        />
        inject into terminal
      </label>
      {needsRestart && (
        <button type="button" className="restart-hint" onClick={restart}>
          ↻ restart terminal to apply
        </button>
      )}
    </div>
  );
}
