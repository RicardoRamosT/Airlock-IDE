// Pure level mappers for the activity-rail status dots. Kept electron-free (and
// out of ide-state) so they unit-test without spinning up main. Each takes
// already-fetched status and returns a DotLevel; ide-state's sectionStatuses()
// does the (impure) fetching and calls these.
import type { Container, DockerStatus, GitStatus } from "@airlock/agent-core";
import type { ActivityItem, DotLevel } from "../shared/ipc";

// Docker: grey = not installed; green = daemon up with a running container;
// yellow = installed but the daemon is off or nothing is running.
export function dockerDot(s: DockerStatus): DotLevel {
  if (!s.installed) return "grey";
  const anyRunning = s.containers.some((c: Container) => c.state === "running");
  if (s.running && anyRunning) return "green";
  return "yellow";
}

// Databases: grey = nothing configured; green = a reachable Postgres OR a
// connected Neon; yellow = configured but nothing reachable.
export function databasesDot(
  postgres: { reachable: boolean }[],
  neonConnected: boolean,
): DotLevel {
  if (postgres.length === 0 && !neonConnected) return "grey";
  if (neonConnected || postgres.some((d) => d.reachable)) return "green";
  return "yellow";
}

// Host: grey = no dev URL and no Render service; green = dev server up OR a
// Render deploy is live; yellow = configured but down / not live.
export function hostDot(
  devUp: boolean | null,
  hasDevUrl: boolean,
  renderLive: boolean,
  hasRender: boolean,
): DotLevel {
  if (devUp === true || renderLive) return "green";
  if (hasDevUrl || hasRender) return "yellow";
  return "grey";
}

// Git: grey = not a repo; green = clean and in sync; yellow = uncommitted
// changes or ahead/behind upstream.
export function gitDot(g: GitStatus | null): DotLevel {
  if (!g) return "grey";
  const dirty = g.staged.length + g.unstaged.length + g.untracked.length > 0;
  const outOfSync = g.branch.ahead > 0 || g.branch.behind > 0;
  return dirty || outOfSync ? "yellow" : "green";
}

// Activity: grey = idle (no in-progress work); red = a failure present; yellow =
// something running; green = items present and all finished cleanly.
export function activityDot(items: ActivityItem[]): DotLevel {
  if (items.length === 0) return "grey";
  if (items.some((i) => i.state === "failed")) return "red";
  if (items.some((i) => i.state === "running")) return "yellow";
  return "green";
}
