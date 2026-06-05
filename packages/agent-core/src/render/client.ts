import { parseLatestDeploy, parseServices } from "./parse";

const RENDER_API_BASE = "https://api.render.com/v1";

export interface RenderService {
  id: string;
  name: string;
  repo: string;
  branch: string;
  url: string;
}
export interface RenderDeploy {
  status: string;
  commit: string;
}

// DI transport so the HTTP edge is swappable in tests. The real adapter uses
// the global fetch in the Electron/Node main process.
export interface RenderTransport {
  get(path: string, key: string): Promise<unknown>;
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
};

const enc = encodeURIComponent;

export async function listServices(
  key: string,
  opts: RenderOptions = {},
): Promise<RenderService[]> {
  const t = opts.transport ?? renderFetchTransport;
  return parseServices(await t.get("/services?limit=100", key));
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
