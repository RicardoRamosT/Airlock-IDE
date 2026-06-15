// packages/agent-core/src/integrations/engine.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IntegrationItem, IntegrationManifest } from "./manifest";
import { mapToItems } from "./map";

const exec = promisify(execFile);

// DI-able runner (mirrors docker.ts / github/ci.ts). The real one shells out
// via execFile -- NO shell, so args are passed safely -- with a timeout so a
// slow tool never stalls the Activity feed.
export type CliRunner = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number },
) => Promise<string>;

const realRunner: CliRunner = async (cmd, args, { cwd, timeoutMs }) => {
  const { stdout } = await exec(cmd, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
};

export type DetectStatus = "absent" | "unauthed" | "ready";

// execFile rejects with code "ENOENT" when the binary is not on PATH, vs a
// numeric exit code when it ran and failed. So ENOENT == not installed.
export function isCommandMissing(e: unknown): boolean {
  return (
    !!e && typeof e === "object" && (e as { code?: unknown }).code === "ENOENT"
  );
}

// Run a manifest's auth check: exit 0 -> ready; ENOENT -> absent (not
// installed); any other failure (incl. timeout) -> unauthed (a mild hint).
export async function detectStatus(
  m: IntegrationManifest,
  cwd: string | undefined,
  timeoutMs: number,
  run: CliRunner,
): Promise<DetectStatus> {
  try {
    await run(m.detect.authCheck.cmd, m.detect.authCheck.args, {
      cwd,
      timeoutMs,
    });
    return "ready";
  } catch (e) {
    return isCommandMissing(e) ? "absent" : "unauthed";
  }
}

// Classify a manifest's surface: the target sidebar view for a steady-state
// manifest, or null for a transient (Activity feed) one.
export function steadyView(m: IntegrationManifest): string | null {
  return typeof m.surface === "object" ? m.surface.view : null;
}

// Run ONE manifest: detect (authCheck exit 0) -> poll -> JSON.parse -> map.
// Any failure (tool missing, not authed, timeout, non-JSON) yields [] so the
// feed degrades silently, exactly like the gh/render/docker blocks.
export async function runManifest(
  m: IntegrationManifest,
  root: string | null,
  run: CliRunner = realRunner,
): Promise<IntegrationItem[]> {
  // detect and poll share one cwd: an auth check (e.g. `vercel whoami`) is
  // global, so running it in the project root is harmless. If a future tool
  // ever needs a cwd-agnostic detect with a cwd-scoped poll, split this then.
  const cwd = m.poll.cwdScoped ? (root ?? undefined) : undefined;
  const timeoutMs = m.poll.timeoutMs ?? 8000;
  try {
    await run(m.detect.authCheck.cmd, m.detect.authCheck.args, {
      cwd,
      timeoutMs,
    });
  } catch {
    return []; // not installed or not authenticated
  }
  let out: string;
  try {
    out = await run(m.poll.cli.cmd, m.poll.cli.args, { cwd, timeoutMs });
  } catch {
    return [];
  }
  let json: unknown;
  try {
    json = JSON.parse(out);
  } catch {
    return [];
  }
  return mapToItems(m, json);
}

// Per-manifest poll cache (mutated in place by the caller, held across calls)
// so the Activity feed's frequent polling does not re-spawn each CLI on every
// tick. Keyed by manifest id.
export interface PollCache {
  [id: string]: { at: number; items: IntegrationItem[] };
}

// Run every manifest, honoring each one's poll.everyMs: if a manifest ran
// within everyMs of `now` (epoch ms), reuse its cached items instead of
// re-spawning. Manifests run concurrently; each degrades to [] on failure so
// one cannot break the others. `now` and `run` are injected for testability.
export async function pollIntegrations(
  manifests: IntegrationManifest[],
  root: string | null,
  now: number,
  cache: PollCache,
  run: CliRunner = realRunner,
): Promise<IntegrationItem[]> {
  const results = await Promise.all(
    manifests
      .filter((m) => steadyView(m) === null)
      .map(async (m) => {
        const cached = cache[m.id];
        if (cached && now - cached.at < m.poll.everyMs) return cached.items;
        let items: IntegrationItem[];
        try {
          items = await runManifest(m, root, run);
        } catch {
          items = [];
        }
        cache[m.id] = { at: now, items };
        return items;
      }),
  );
  return results.flat();
}

// One steady-state integration's standing status for a sidebar view.
export interface SteadyIntegration {
  id: string;
  name: string;
  view: string; // target sidebar view, e.g. "databases"
  status: DetectStatus; // absent | unauthed | ready
  resources: IntegrationItem[]; // [] unless ready
  // Passed through from the manifest so the renderer can offer an Install button
  // on the absent row / a Connect button on the unauthed row (each runs its
  // command in a new terminal).
  install?: { command: string; docsUrl?: string };
  connect?: { command: string; docsUrl?: string };
}

// Steady analogue of PollCache: caches the whole SteadyIntegration per id.
export interface SteadyCache {
  [id: string]: { at: number; value: SteadyIntegration };
}

// Steady analogue of pollIntegrations: for each VIEW-targeted manifest, detect
// (absent|unauthed|ready), and when ready poll + mapToItems for its resources.
// Per-manifest everyMs throttle via SteadyCache; each degrades independently
// (a failed probe on an authed tool -> ready with no rows, not "not connected").
export async function pollSteady(
  manifests: IntegrationManifest[],
  root: string | null,
  now: number,
  cache: SteadyCache,
  run: CliRunner = realRunner,
): Promise<SteadyIntegration[]> {
  const steady = manifests.filter((m) => steadyView(m) !== null);
  return Promise.all(
    steady.map(async (m) => {
      const cached = cache[m.id];
      if (cached && now - cached.at < m.poll.everyMs) return cached.value;
      const view = steadyView(m) as string;
      const cwd = m.poll.cwdScoped ? (root ?? undefined) : undefined;
      const timeoutMs = m.poll.timeoutMs ?? 8000;
      const status = await detectStatus(m, cwd, timeoutMs, run);
      let resources: IntegrationItem[] = [];
      if (status === "ready") {
        try {
          const out = await run(m.poll.cli.cmd, m.poll.cli.args, {
            cwd,
            timeoutMs,
          });
          resources = mapToItems(m, JSON.parse(out));
        } catch {
          resources = []; // authed, but this probe failed/garbage: show header, no rows
        }
      }
      const value: SteadyIntegration = {
        id: m.id,
        name: m.name,
        view,
        status,
        resources,
        ...(m.install ? { install: m.install } : {}),
        ...(m.connect ? { connect: m.connect } : {}),
      };
      cache[m.id] = { at: now, value };
      return value;
    }),
  );
}
