import { useCallback, useEffect, useState } from "react";
import type { EnvDiffEntry, RenderServiceStatus } from "../../../shared/ipc";

const STATUS_LABEL: Record<EnvDiffEntry["status"], string> = {
  equal: "equal",
  differs: "differs",
  "only-a": "only dev",
  "only-b": "only prod",
};

// Render env vars for the project's services, inside the Secrets section.
// Values are masked; a reveal pulls one value (audited main-side) into a
// transient map keyed `${serviceId}:${key}`. The agent never sees any of this.
export function RenderEnvSection() {
  const [services, setServices] = useState<RenderServiceStatus[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string[]>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [compare, setCompare] = useState<EnvDiffEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { connected } = await window.airlock.renderStatus();
        if (!connected || !alive) return;
        const list = await window.airlock.renderServices();
        if (alive) setServices(list);
      } catch {
        /* not connected / API down -> show nothing */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const expand = useCallback(
    async (id: string) => {
      if (expanded === id) {
        setExpanded(null);
        return;
      }
      setExpanded(id);
      setError(null);
      try {
        const k = await window.airlock.renderEnvKeys(id);
        setKeys((m) => ({ ...m, [id]: k }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [expanded],
  );

  const toggleReveal = useCallback(
    async (serviceId: string, key: string) => {
      const id = `${serviceId}:${key}`;
      if (revealed[id] !== undefined) {
        setRevealed((r) => {
          const next = { ...r };
          delete next[id];
          return next;
        });
        return;
      }
      const v = await window.airlock.renderEnvReveal(serviceId, key);
      setRevealed((r) => ({ ...r, [id]: v ?? "(not found)" }));
    },
    [revealed],
  );

  const runCompare = useCallback(async () => {
    if (services.length < 2) return;
    const a = services[0];
    const b = services[1];
    if (!a || !b) return;
    try {
      setCompare(await window.airlock.renderEnvCompare(a.id, b.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [services]);

  if (services.length === 0) return null;

  return (
    <div className="render-env">
      <div className="settings-sublabel">Render env</div>
      {error && <div className="section-note">{error}</div>}
      {services.map((svc) => (
        <div key={svc.id}>
          <button
            type="button"
            className="render-env-svc"
            onClick={() => void expand(svc.id)}
          >
            <i
              className={`codicon codicon-chevron-${expanded === svc.id ? "down" : "right"}`}
            />
            {svc.name}
          </button>
          {expanded === svc.id &&
            (keys[svc.id] ?? []).map((k) => {
              const rid = `${svc.id}:${k}`;
              return (
                <div key={k} className="render-env-row">
                  <span className="render-env-key">{k}</span>
                  <button
                    type="button"
                    className="render-env-reveal"
                    title="Reveal value"
                    onClick={() => void toggleReveal(svc.id, k)}
                  >
                    {revealed[rid] !== undefined ? revealed[rid] : "••••"}
                  </button>
                </div>
              );
            })}
        </div>
      ))}
      {services.length >= 2 && (
        <button
          type="button"
          className="render-env-compare-btn"
          onClick={() => void runCompare()}
        >
          Compare {services[0]?.name} ↔ {services[1]?.name}
        </button>
      )}
      {compare && (
        <div className="render-env-compare">
          {compare.map((d) => (
            <div
              key={d.key}
              className={`render-env-diff render-env-diff--${d.status}`}
            >
              <span className="render-env-key">{d.key}</span>
              <span className="render-env-status">
                {STATUS_LABEL[d.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
