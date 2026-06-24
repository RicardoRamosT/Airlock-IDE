import { parseDeploys, parseLatestDeploy, parseServices } from "./parse";

const RENDER_API_BASE = "https://api.render.com/v1";

export interface RenderService {
  id: string;
  name: string;
  repo: string;
  branch: string;
  url: string;
  type: string; // "web_service" | "static_site" | "background_worker" | ...
  region: string;
  plan: string;
  autoDeploy: boolean | null; // Render reports "yes"/"no"; null when unknown
  dashboardUrl: string;
}
export interface RenderDeploy {
  id: string;
  status: string;
  commit: string; // commit sha
  message: string; // first line of the commit message
  at: string; // finishedAt || createdAt (ISO)
  trigger: string; // e.g. "deploy", "api", "manual"
}

// DI transport so the HTTP edge is swappable in tests. The real adapter uses
// the global fetch in the Electron/Node main process.
export interface RenderTransport {
  get(path: string, key: string): Promise<unknown>;
  post(path: string, key: string, body?: unknown): Promise<unknown>;
}
export interface RenderOptions {
  transport?: RenderTransport;
}

export const renderFetchTransport: RenderTransport = {
  async get(path, key) {
    const res = await fetch(`${RENDER_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Render API ${res.status} ${res.statusText}`);
    return res.json();
  },
  async post(path, key, body) {
    const res = await fetch(`${RENDER_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Render API ${res.status} ${res.statusText}`);
    // A 202/empty body is fine for a deploy trigger; tolerate non-JSON.
    return res.json().catch(() => null);
  },
};

const enc = encodeURIComponent;

export async function listServices(
  key: string,
  opts: RenderOptions = {},
): Promise<RenderService[]> {
  const t = opts.transport ?? renderFetchTransport;
  return parseServices(await t.get("/services?limit=100", key));
}

// Recent deploys for a service, newest first (the Render API order).
export async function listDeploys(
  key: string,
  serviceId: string,
  limit = 5,
  opts: RenderOptions = {},
): Promise<RenderDeploy[]> {
  const t = opts.transport ?? renderFetchTransport;
  return parseDeploys(
    await t.get(`/services/${enc(serviceId)}/deploys?limit=${limit}`, key),
  );
}

export async function latestDeploy(
  key: string,
  serviceId: string,
  opts: RenderOptions = {},
): Promise<RenderDeploy | null> {
  const t = opts.transport ?? renderFetchTransport;
  return parseLatestDeploy(
    await t.get(`/services/${enc(serviceId)}/deploys?limit=1`, key),
  );
}

// Trigger a new deploy of the service's connected branch (Render deploys the
// latest commit by default). Owner-initiated only; the caller refetches to
// show the resulting in-progress deploy.
export async function triggerDeploy(
  key: string,
  serviceId: string,
  opts: RenderOptions = {},
): Promise<void> {
  const t = opts.transport ?? renderFetchTransport;
  await t.post(`/services/${enc(serviceId)}/deploys`, key, {});
}
