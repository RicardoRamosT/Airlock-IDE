import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderDeploy, RenderServiceStatus } from "../../../shared/ipc";
import { relativeTime } from "../lib/overviewFreshness";
import { useApp } from "../store";

// Maps a Render deploy status string to one of the three shared status-dot
// classes. "live" is the only definitively-good state (green); anything that
// reads as failed/canceled/deactivated is red; every transient/unknown state
// (created, *_in_progress, pre_deploy, "") is the neutral grey dot.
function dotClass(deployStatus: string): string {
  const s = deployStatus.toLowerCase();
  if (s === "live") return "status-dot on";
  // Only genuine failures are red. "deactivated" is the NORMAL state of a
  // superseded (older) deploy, not a failure -> neutral grey, like in-progress.
  if (s.includes("fail") || s.includes("cancel")) return "status-dot fail";
  return "status-dot";
}

// "web_service" -> "Web Service"; "" -> "".
function fmtType(t: string): string {
  return t
    .split("_")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}
const cap = (s: string): string => (s ? s[0]?.toUpperCase() + s.slice(1) : "");
// ISO -> "2h ago" (""/invalid -> "").
function ago(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : relativeTime(t, Date.now());
}

// One service row: a click-to-expand summary over a details + deploy-history +
// actions body (matches the steady-integration rows). Deploy history loads
// lazily on first expand; the Deploy action runs behind an inline confirm.
function ServiceRow({
  svc,
  onChanged,
}: {
  svc: RenderServiceStatus;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deploys, setDeploys] = useState<RenderDeploy[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deploying, setDeploying] = useState(false);

  // Lazy-load recent deploys the first time the row opens.
  useEffect(() => {
    if (!open || deploys !== null) return;
    let cancelled = false;
    window.airlock
      .renderDeploys(svc.id)
      .then((d) => {
        if (!cancelled) setDeploys(d);
      })
      .catch(() => {
        if (!cancelled) setDeploys([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, deploys, svc.id]);

  const details: [string, string][] = [];
  if (svc.type) details.push(["Type", fmtType(svc.type)]);
  const regionPlan = [cap(svc.region), cap(svc.plan)]
    .filter(Boolean)
    .join(" · ");
  if (regionPlan) details.push(["Plan", regionPlan]);
  if (svc.branch) {
    const auto =
      svc.autoDeploy === true
        ? " · auto-deploy"
        : svc.autoDeploy === false
          ? " · manual"
          : "";
    details.push(["Branch", `${svc.branch}${auto}`]);
  }
  if (svc.lastDeploy) {
    const ld = svc.lastDeploy;
    const parts = [
      ago(ld.at),
      ld.commit ? ld.commit.slice(0, 7) : "",
      ld.message ? `“${ld.message}”` : "",
    ].filter(Boolean);
    if (parts.length) details.push(["Deploy", parts.join(" · ")]);
  }

  const doDeploy = () => {
    setDeploying(true);
    window.airlock
      .renderDeploy(svc.id)
      .then(() => {
        setConfirming(false);
        setDeploys(null); // force a history refetch on next open
        onChanged(); // refresh the service list (new in-progress deploy)
      })
      .catch(() => {})
      .finally(() => setDeploying(false));
  };

  return (
    <div className="int-resource">
      <button
        type="button"
        className="docker-row"
        aria-expanded={open}
        title={svc.name}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
        <span className={dotClass(svc.deployStatus)} />
        <span className="docker-name">{svc.name}</span>
        <span className="docker-image">{svc.deployStatus}</span>
        {svc.deployed === true ? (
          <span className="host-badge" title="Deployed commit matches HEAD">
            <i className="codicon codicon-check" /> live
          </span>
        ) : svc.deployed === false ? (
          <span className="host-diff" title="Deployed commit differs from HEAD">
            HEAD differs
          </span>
        ) : null}
      </button>
      {open && (
        <div className="int-body">
          {details.map(([label, value]) => (
            <div key={label} className="int-detail">
              <span className="int-detail-label">{label}</span>
              <span className="int-detail-value">{value}</span>
            </div>
          ))}

          {deploys === null ? (
            <div className="section-note">loading deploys…</div>
          ) : deploys.length > 0 ? (
            <div className="render-deploys">
              {deploys.map((d, i) => (
                <div key={d.id || `${d.at}-${i}`} className="render-deploy">
                  <span className={dotClass(d.status)} />
                  <span className="render-deploy-status">{d.status}</span>
                  <span className="render-deploy-at">{ago(d.at)}</span>
                  {d.commit && (
                    <span className="render-deploy-sha">
                      {d.commit.slice(0, 7)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="section-toolbar">
            {svc.url && (
              <button
                type="button"
                className="btn"
                title={svc.url}
                onClick={() => void window.airlock.hostOpenExternal(svc.url)}
              >
                <i className="codicon codicon-link-external" /> Site
              </button>
            )}
            {svc.dashboardUrl && (
              <button
                type="button"
                className="btn"
                title="Open the Render dashboard"
                onClick={() =>
                  void window.airlock.hostOpenExternal(svc.dashboardUrl)
                }
              >
                <i className="codicon codicon-dashboard" /> Dashboard
              </button>
            )}
            {!confirming && (
              <button
                type="button"
                className="btn"
                title="Trigger a new deploy"
                onClick={() => setConfirming(true)}
              >
                <i className="codicon codicon-rocket" /> Deploy
              </button>
            )}
          </div>

          {confirming && (
            <div className="render-confirm">
              <span className="section-note">
                Deploy latest commit of {svc.branch || "the connected branch"}?
              </span>
              <div className="section-toolbar">
                <button
                  type="button"
                  className="btn"
                  disabled={deploying}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={deploying}
                  onClick={doDeploy}
                >
                  Deploy
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The Render group of the Host section. Mirrors NeonSection's three-way
// (checking / connect / connected) + re-check-on-modal-close + mounted-ref
// guard, and DockerSection's row vocabulary + busy-guarded manual refresh.
//
//   connected===null  -> "checking…"
//   connected===false -> a Connect Render button (opens the Task 4 modal)
//   connected===true  -> the per-project service list (one expandable row each)
export function RenderSection() {
  const modal = useApp((s) => s.modal);
  const hostRefreshNonce = useApp((s) => s.hostRefreshNonce);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [services, setServices] = useState<RenderServiceStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    try {
      const list = await window.airlock.renderServices();
      if (mounted.current) setServices(list);
    } catch (e) {
      console.error("renderServices failed", e);
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Once connected, (re)load the service list — also when the single HOST-header
  // Refresh bumps hostRefreshNonce.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hostRefreshNonce is not read in the body but intentionally included as a trigger dep.
  useEffect(() => {
    if (connected !== true) return;
    void loadServices();
  }, [connected, loadServices, hostRefreshNonce]);

  if (connected === null) return <div className="section-note">checking…</div>;

  if (connected === false) {
    return (
      <div className="databases">
        <div className="section-toolbar">
          <button
            type="button"
            className="btn"
            onClick={() => useApp.getState().setModal("connect-render")}
          >
            Connect Render
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="docker">
      {error && <div className="modal-error">{error}</div>}
      {services.length === 0 ? (
        <div className="section-note">No services for this project</div>
      ) : (
        services.map((svc) => (
          <ServiceRow key={svc.id} svc={svc} onChanged={loadServices} />
        ))
      )}
    </div>
  );
}
