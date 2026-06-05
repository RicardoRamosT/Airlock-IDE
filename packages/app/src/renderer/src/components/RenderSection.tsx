import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderServiceStatus } from "../../../shared/ipc";
import { useApp } from "../store";

// Maps a Render deploy status string to one of the three shared status-dot
// classes. "live" is the only definitively-good state (green); anything that
// reads as failed/canceled/deactivated is red; every transient/unknown state
// (created, *_in_progress, pre_deploy, "") is the neutral grey dot.
function dotClass(deployStatus: string): string {
  const s = deployStatus.toLowerCase();
  if (s === "live") return "status-dot on";
  if (s.includes("fail") || s.includes("cancel") || s.includes("deactiv"))
    return "status-dot fail";
  return "status-dot";
}

// The Render group of the Host section. Mirrors NeonSection's three-way
// (checking / connect / connected) + re-check-on-modal-close + mounted-ref
// guard, and DockerSection's row vocabulary + busy-guarded manual refresh.
//
//   connected===null  -> "checking…"
//   connected===false -> a Connect Render button (opens the Task 4 modal)
//   connected===true  -> the per-project service list (one docker-row each)
export function RenderSection() {
  const modal = useApp((s) => s.modal);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [services, setServices] = useState<RenderServiceStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Guards every async setState against an unmount-in-flight (like NeonSection).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Connection status on mount, and again whenever the modal closes
  // (modal === null) so the list appears the moment the user finishes the
  // Connect Render modal.
  useEffect(() => {
    if (modal !== null) return;
    window.airlock
      .renderStatus()
      .then((s) => {
        if (mounted.current) setConnected(s.connected);
      })
      .catch((e: unknown) => {
        if (mounted.current) {
          console.error("renderStatus failed", e);
          setConnected(false);
        }
      });
  }, [modal]);

  const loadServices = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await window.airlock.renderServices();
      if (mounted.current) setServices(list);
    } catch (e) {
      console.error("renderServices failed", e);
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  // Once connected, load the project's service list.
  useEffect(() => {
    if (connected !== true) return;
    void loadServices();
  }, [connected, loadServices]);

  if (connected === null) return <div className="section-note">checking…</div>;

  if (connected === false) {
    return (
      <div className="databases">
        <button
          type="button"
          className="btn"
          onClick={() => useApp.getState().setModal("connect-render")}
        >
          Connect Render
        </button>
      </div>
    );
  }

  return (
    <div className="docker">
      <div className="db-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => void loadServices()}
          disabled={busy}
          title="Refresh services"
        >
          <i className="codicon codicon-refresh" /> Refresh
        </button>
      </div>
      {error && <div className="modal-error">{error}</div>}
      {services.length === 0 ? (
        <div className="section-note">No services for this project</div>
      ) : (
        services.map((svc) => (
          <div key={svc.id} className="docker-row" title={svc.name}>
            <span className={dotClass(svc.deployStatus)} />
            <span className="docker-name">{svc.name}</span>
            <span className="docker-image">{svc.deployStatus}</span>
            {svc.deployed === true ? (
              <span className="host-badge" title="Deployed commit matches HEAD">
                <i className="codicon codicon-check" /> live
              </span>
            ) : svc.deployed === false ? (
              <span
                className="host-diff"
                title="Deployed commit differs from HEAD"
              >
                HEAD differs
              </span>
            ) : null}
            {svc.url && (
              <button
                type="button"
                className="docker-action"
                onClick={() => void window.airlock.hostOpenExternal(svc.url)}
                title="Open in browser"
              >
                <i className="codicon codicon-link-external" />
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
