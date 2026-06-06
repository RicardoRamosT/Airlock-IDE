// Activity aggregation: gather in-progress operations (CI, Render, Docker) into
// a single ActivityItem[] for the Activity panel. The pure mappers are TDD'd;
// activityStatus does the I/O (gh + Render + docker) and delegates to them.
// ASCII-only comments: CJS-bundled into the Electron main process.
import { type CiRun, latestCiRun } from "@airlock/agent-core";
import type { ActivityItem } from "../shared/ipc";
import { dockerStatus, gitStatusFor, renderServicesStatus } from "./ide-state";

// App-global, in-memory set of dismissed activity ids (e.g. "ci:<sha>",
// "render:<id>", "docker:<id>"). Activity is ephemeral, so this is NOT persisted
// across restart -- the feed rebuilds. activityStatus filters these out, so every
// reader (the activity:status IPC and the future MCP read tool) sees the filtered
// feed automatically. addDismissedActivity is reused by the dismiss IPC and the
// later MCP dismiss tool.
const dismissed = new Set<string>();

export function addDismissedActivity(id: string): void {
  dismissed.add(id);
}

export function isActivityDismissed(id: string): boolean {
  return dismissed.has(id);
}

// Pure filter, unit-testable without driving the gh/render/docker I/O in
// activityStatus. Keeps the dismissed-id logic in one place.
export function filterDismissed(
  items: ActivityItem[],
  dismissedSet: Set<string>,
): ActivityItem[] {
  return items.filter((i) => !dismissedSet.has(i.id));
}

export function ciRunState(run: CiRun): ActivityItem["state"] {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "done";
  if (
    run.conclusion === "failure" ||
    run.conclusion === "cancelled" ||
    run.conclusion === "timed_out" ||
    run.conclusion === "action_required" ||
    run.conclusion === "startup_failure" ||
    run.conclusion === "stale"
  ) {
    return "failed";
  }
  return "idle"; // skipped | neutral | null | anything benign
}

export function ciRunToItem(run: CiRun, branch: string): ActivityItem {
  const state = ciRunState(run);
  let progress: ActivityItem["progress"];
  if (run.stepsTotal > 0) {
    progress = {
      kind: "determinate",
      value: Math.round((run.stepsDone / run.stepsTotal) * 100),
      label: `${run.stepsDone}/${run.stepsTotal} steps`,
    };
  } else if (state === "running") {
    progress = { kind: "indeterminate" };
  } else {
    progress = null;
  }
  return {
    id: `ci:${run.headSha}`,
    kind: "ci",
    title: run.workflowName || "CI",
    subtitle: branch,
    state,
    progress,
    steps: run.steps,
    href: run.url || undefined,
  };
}

export function renderDeployState(deployStatus: string): ActivityItem["state"] {
  const s = deployStatus.toLowerCase();
  if (!s) return "idle";
  if (s === "live") return "done";
  if (s.includes("fail") || s.includes("cancel") || s.includes("deactiv")) {
    return "failed";
  }
  return "running"; // build_in_progress | update_in_progress | created | queued | ...
}

export function renderServiceToItem(svc: {
  id: string;
  name: string;
  url: string;
  deployStatus: string;
}): ActivityItem | null {
  const state = renderDeployState(svc.deployStatus);
  // Only surface mid-deploy or recently-failed services; "live" is the steady
  // state (it has its own dot in the Host section).
  if (state !== "running" && state !== "failed") return null;
  return {
    id: `render:${svc.id}`,
    kind: "render",
    title: svc.name,
    subtitle: svc.deployStatus || "deploying",
    state,
    progress: state === "running" ? { kind: "indeterminate" } : null,
    href: svc.url || undefined,
  };
}

export function dockerContainerToItem(c: {
  id: string;
  name: string;
  state: string;
  status: string;
}): ActivityItem | null {
  // Transitional only -- a steady "running" or "exited" container is not activity.
  if (c.state !== "created" && c.state !== "restarting") return null;
  return {
    id: `docker:${c.id}`,
    kind: "docker",
    title: c.name,
    subtitle: c.status || c.state,
    state: "running",
    progress: { kind: "indeterminate" },
  };
}

export async function activityStatus(
  root: string | null,
): Promise<ActivityItem[]> {
  const items: ActivityItem[] = [];

  // CI (repo-gated): the latest workflow run for the current branch.
  if (root) {
    try {
      const branch = (await gitStatusFor(root)).branch.head;
      if (branch && branch !== "(detached)") {
        const run = await latestCiRun(branch, root);
        if (run) items.push(ciRunToItem(run, branch));
      }
    } catch {
      // not a repo / gh missing / no workflows -> no CI item
    }
  }

  // Render deploys (needs the global key + a repo for the remote filter).
  try {
    const services = await renderServicesStatus(root);
    for (const svc of services) {
      const item = renderServiceToItem(svc);
      if (item) items.push(item);
    }
  } catch {
    // Render not connected -> no render items
  }

  // Docker: transitional containers.
  try {
    const docker = await dockerStatus();
    for (const c of docker.containers) {
      const item = dockerContainerToItem(c);
      if (item) items.push(item);
    }
  } catch {
    // docker not installed -> no docker items
  }

  // Hide anything the user (or the agent) dismissed; a NEW state has a new id and
  // reappears. Applied last so it covers every source.
  return filterDismissed(items, dismissed);
}
