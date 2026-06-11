import { type LatestRelease, parseLatestRelease } from "./parse";

export type { LatestRelease };

export const AIRLOCK_REPO = "RicardoRamosT/Airlock-IDE";

// DI transport (mirrors render/client). GitHub requires a User-Agent header.
export interface UpdateTransport {
  get(url: string): Promise<unknown>;
}
export interface UpdateOptions {
  transport?: UpdateTransport;
}

export const updateFetchTransport: UpdateTransport = {
  async get(url) {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AirLock",
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
    return res.json();
  },
};

export async function fetchLatestRelease(
  repo: string,
  opts: UpdateOptions = {},
): Promise<LatestRelease | null> {
  const t = opts.transport ?? updateFetchTransport;
  return parseLatestRelease(
    await t.get(`https://api.github.com/repos/${repo}/releases/latest`),
  );
}
