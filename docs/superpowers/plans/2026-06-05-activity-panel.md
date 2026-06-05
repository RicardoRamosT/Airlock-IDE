# Activity Panel (live pipeline progress) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable "Activity" sidebar section: a unified, animated live feed of in-progress operations (GitHub CI runs, Render deploys, transitional Docker containers), polled while active.

**Architecture:** A new electron-free agent-core CI client (`github/ci.ts`, mirrors `github/accounts.ts`) reads the latest GitHub Actions run via `gh`. A new main-side `activity.ts` aggregates CI + Render (reused `renderServicesStatus`) + Docker (reused `dockerStatus`) into `ActivityItem[]` behind a single `activity:status` IPC. A new `ActivitySection` renderer component polls it (mount-driven, so collapsing the section unmounts it and stops the timer) and renders each item with a CSS animation vocabulary (determinate fill, indeterminate shimmer, pulsing dot, CI step-checklist).

**Tech Stack:** TypeScript (strict), `gh` CLI (via execFile, no token exposure), Electron IPC, React 19, Zustand, CSS keyframes, vitest.

**Design spec:** `docs/superpowers/specs/2026-06-05-activity-panel-design.md`

**Key constraints:**
- ASCII-only comments/strings in `packages/agent-core/src/**` and `packages/app/src/main/**` (CJS-bundled; cjs_lexer crashes on multibyte). The renderer (`ActivitySection.tsx`, `theme.css`) is EXEMPT (may use unicode).
- No secret value path: CI/deploy/container status is non-secret metadata. `gh` holds the GitHub token; Render uses the existing main-only vaulted key. Nothing new touches a secret value.
- The honest progress model: determinate bar ONLY where the source gives discrete steps (CI). Indeterminate shimmer where it gives only a state (Render building, Docker starting). Never a fabricated number.

---

## Task 1: agent-core CI client (`github/ci.ts`)

**Files:**
- Create: `packages/agent-core/src/github/ci.ts`
- Create: `packages/agent-core/src/github/ci.test.ts`
- Modify: `packages/agent-core/src/index.ts` (barrel export)

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-core/src/github/ci.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type GhRunner, latestCiRun, parseRunJobs, parseRunList } from "./ci";

describe("parseRunList", () => {
  it("returns the first run", () => {
    const raw = JSON.stringify([
      {
        databaseId: 42,
        status: "in_progress",
        conclusion: null,
        workflowName: "CI",
        headSha: "abc123",
        url: "https://gh/42",
      },
    ]);
    expect(parseRunList(raw)).toEqual({
      databaseId: 42,
      status: "in_progress",
      conclusion: null,
      workflowName: "CI",
      headSha: "abc123",
      url: "https://gh/42",
    });
  });

  it("returns null for an empty array or empty output", () => {
    expect(parseRunList("[]")).toBeNull();
    expect(parseRunList("")).toBeNull();
    expect(parseRunList("   ")).toBeNull();
  });
});

describe("parseRunJobs", () => {
  it("flattens steps across jobs and counts completed", () => {
    const raw = JSON.stringify({
      jobs: [
        {
          name: "build",
          status: "completed",
          conclusion: "success",
          steps: [
            { name: "checkout", status: "completed", conclusion: "success" },
            { name: "install", status: "completed", conclusion: "success" },
          ],
        },
        {
          name: "test",
          status: "in_progress",
          conclusion: null,
          steps: [
            { name: "unit", status: "in_progress", conclusion: null },
            { name: "e2e", status: "queued", conclusion: null },
          ],
        },
      ],
    });
    const r = parseRunJobs(raw);
    expect(r.stepsTotal).toBe(4);
    expect(r.stepsDone).toBe(2);
    expect(r.steps[0]).toEqual({ name: "checkout", status: "completed", conclusion: "success" });
    expect(r.steps[3]).toEqual({ name: "e2e", status: "queued", conclusion: null });
  });

  it("handles no jobs / empty output", () => {
    expect(parseRunJobs("")).toEqual({ steps: [], stepsDone: 0, stepsTotal: 0 });
    expect(parseRunJobs(JSON.stringify({ jobs: [] }))).toEqual({ steps: [], stepsDone: 0, stepsTotal: 0 });
  });
});

describe("latestCiRun", () => {
  it("composes list + view into a CiRun and uses the right argv", async () => {
    const calls: string[][] = [];
    const fake: GhRunner = async (args) => {
      calls.push(args);
      if (args[1] === "list") {
        return JSON.stringify([
          {
            databaseId: 7,
            status: "in_progress",
            conclusion: null,
            workflowName: "CI",
            headSha: "deadbeef",
            url: "https://gh/7",
          },
        ]);
      }
      return JSON.stringify({
        jobs: [
          {
            name: "build",
            status: "in_progress",
            conclusion: null,
            steps: [
              { name: "a", status: "completed", conclusion: "success" },
              { name: "b", status: "in_progress", conclusion: null },
            ],
          },
        ],
      });
    };
    const run = await latestCiRun("feature/x", fake);
    expect(run?.workflowName).toBe("CI");
    expect(run?.stepsDone).toBe(1);
    expect(run?.stepsTotal).toBe(2);
    expect(run?.url).toBe("https://gh/7");
    expect(calls[0]).toEqual([
      "run", "list", "--branch", "feature/x", "--limit", "1",
      "--json", "databaseId,status,conclusion,workflowName,headSha,url",
    ]);
    expect(calls[1]).toEqual(["run", "view", "7", "--json", "jobs"]);
  });

  it("returns null when there are no runs", async () => {
    const fake: GhRunner = async () => "[]";
    expect(await latestCiRun("main", fake)).toBeNull();
  });

  it("returns null when gh is missing (ENOENT)", async () => {
    const fake: GhRunner = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOENT" });
    };
    expect(await latestCiRun("main", fake)).toBeNull();
  });

  it("rejects an invalid branch without shelling out", async () => {
    let called = false;
    const fake: GhRunner = async () => {
      called = true;
      return "[]";
    };
    expect(await latestCiRun("bad branch; rm -rf", fake)).toBeNull();
    expect(called).toBe(false);
  });

  it("still returns the run when step detail is unavailable", async () => {
    const fake: GhRunner = async (args) => {
      if (args[1] === "list") {
        return JSON.stringify([
          {
            databaseId: 1,
            status: "completed",
            conclusion: "success",
            workflowName: "CI",
            headSha: "x",
            url: "u",
          },
        ]);
      }
      throw new Error("no jobs available");
    };
    const run = await latestCiRun("main", fake);
    expect(run?.stepsTotal).toBe(0);
    expect(run?.conclusion).toBe("success");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/ricardoramos/Projects/airlock && npx vitest run packages/agent-core/src/github/ci.test.ts`
Expected: FAIL ("Cannot find module './ci'").

- [ ] **Step 3: Implement `ci.ts`**

Create `packages/agent-core/src/github/ci.ts` (ASCII-only comments):

```ts
// GitHub Actions CI client. Mirrors github/accounts.ts: a DI-able gh runner,
// pure parsers (TDD'd), and a thin composer. gh holds the token; airlock never
// sees it. ASCII-only comments: this module is CJS-bundled into the Electron
// main process and the cjs_lexer crashes on multibyte characters.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type GhRunner = (args: string[]) => Promise<string>;

const realGh: GhRunner = async (args) => {
  const { stdout } = await exec("gh", args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
};

export interface CiStep {
  name: string;
  status: string; // queued | in_progress | completed | ...
  conclusion: string | null; // success | failure | skipped | ... | null
}

export interface CiRun {
  workflowName: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ... | null
  headSha: string;
  url: string;
  steps: CiStep[];
  stepsDone: number;
  stepsTotal: number;
}

interface RunListEntry {
  databaseId: number;
  status: string;
  conclusion: string | null;
  workflowName: string;
  headSha: string;
  url: string;
}

// Parse `gh run list --json ...` (a JSON array); return the first run or null.
export function parseRunList(raw: string): RunListEntry | null {
  const text = raw.trim();
  if (!text) return null;
  const arr = JSON.parse(text) as RunListEntry[];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[0];
}

interface JobsPayload {
  jobs?: {
    name: string;
    status: string;
    conclusion: string | null;
    steps?: { name: string; status: string; conclusion: string | null }[];
  }[];
}

// Parse `gh run view <id> --json jobs`; flatten steps across jobs + count done.
export function parseRunJobs(raw: string): {
  steps: CiStep[];
  stepsDone: number;
  stepsTotal: number;
} {
  const text = raw.trim();
  if (!text) return { steps: [], stepsDone: 0, stepsTotal: 0 };
  const payload = JSON.parse(text) as JobsPayload;
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const steps: CiStep[] = [];
  for (const job of jobs) {
    const jobSteps = Array.isArray(job.steps) ? job.steps : [];
    for (const s of jobSteps) {
      steps.push({ name: s.name, status: s.status, conclusion: s.conclusion ?? null });
    }
  }
  const stepsDone = steps.filter((s) => s.status === "completed").length;
  return { steps, stepsDone, stepsTotal: steps.length };
}

// Branch names from git: letters/digits/._/- . execFile passes argv (no shell),
// so this is defense-in-depth, not the only guard.
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;

// The latest workflow run for a branch, with flattened step detail. Returns
// null for any failure (gh missing, no repo, no auth, no workflows, no runs) --
// the Activity panel just shows no CI item in those cases.
export async function latestCiRun(
  branch: string,
  run: GhRunner = realGh,
): Promise<CiRun | null> {
  if (!branch || !BRANCH_RE.test(branch)) return null;
  let listRaw: string;
  try {
    listRaw = await run([
      "run", "list", "--branch", branch, "--limit", "1",
      "--json", "databaseId,status,conclusion,workflowName,headSha,url",
    ]);
  } catch {
    return null;
  }
  const summary = parseRunList(listRaw);
  if (!summary) return null;
  let jobsRaw = "";
  try {
    jobsRaw = await run(["run", "view", String(summary.databaseId), "--json", "jobs"]);
  } catch {
    jobsRaw = ""; // step detail unavailable -> show the run without steps
  }
  const { steps, stepsDone, stepsTotal } = parseRunJobs(jobsRaw);
  return {
    workflowName: summary.workflowName,
    status: summary.status,
    conclusion: summary.conclusion ?? null,
    headSha: summary.headSha,
    url: summary.url,
    steps,
    stepsDone,
    stepsTotal,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/ricardoramos/Projects/airlock && npx vitest run packages/agent-core/src/github/ci.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Add the barrel export**

In `packages/agent-core/src/index.ts`, add a new export block next to the existing `./github/accounts` block:

```ts
export { type CiRun, type CiStep, latestCiRun } from "./github/ci";
```

(Do NOT export `GhRunner`/`parseRunList`/`parseRunJobs` from the barrel -- they are internal; the test imports them from `./ci` directly. `ide-state`/`activity` only need `latestCiRun` + `CiRun`/`CiStep`.)

- [ ] **Step 6: Typecheck + commit**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck`
Expected: clean.

```bash
git add packages/agent-core/src/github/ci.ts packages/agent-core/src/github/ci.test.ts packages/agent-core/src/index.ts
git commit -m "feat(activity): agent-core CI client (gh run list/view -> CiRun)"
```

---

## Task 2: Activity aggregation + IPC + shared type

**Files:**
- Create: `packages/app/src/main/activity.ts`
- Create: `packages/app/src/main/activity.test.ts`
- Modify: `packages/app/src/shared/ipc.ts` (add `ActivityStep`, `ActivityItem`, and `activityStatus()` to `AirlockApi`)
- Modify: `packages/app/src/main/ipc.ts` (register `activity:status`)
- Modify: `packages/app/src/preload/index.ts` (add `activityStatus`)

- [ ] **Step 1: Add the shared types + API method**

In `packages/app/src/shared/ipc.ts`, add these interfaces near `RenderServiceStatus` (around ipc.ts:62-69):

```ts
export interface ActivityStep {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface ActivityItem {
  id: string;
  kind: "ci" | "render" | "docker";
  title: string;
  subtitle: string;
  state: "running" | "done" | "failed" | "idle";
  progress:
    | { kind: "determinate"; value: number; label: string }
    | { kind: "indeterminate" }
    | null;
  steps?: ActivityStep[];
  href?: string;
}
```

And add to the `AirlockApi` interface (near the render entries at ipc.ts:197-205):

```ts
  activityStatus(): Promise<ActivityItem[]>;
```

- [ ] **Step 2: Write the failing tests for the pure mappers**

Create `packages/app/src/main/activity.test.ts`:

```ts
import type { CiRun } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import {
  ciRunState,
  ciRunToItem,
  dockerContainerToItem,
  renderDeployState,
  renderServiceToItem,
} from "./activity";

const ci = (over: Partial<CiRun>): CiRun => ({
  workflowName: "CI",
  status: "in_progress",
  conclusion: null,
  headSha: "abc",
  url: "u",
  steps: [],
  stepsDone: 0,
  stepsTotal: 0,
  ...over,
});

describe("ciRunState", () => {
  it("running while not completed", () => {
    expect(ciRunState(ci({ status: "in_progress" }))).toBe("running");
    expect(ciRunState(ci({ status: "queued" }))).toBe("running");
  });
  it("done on success", () => {
    expect(ciRunState(ci({ status: "completed", conclusion: "success" }))).toBe("done");
  });
  it("failed on failure/cancelled/timed_out", () => {
    expect(ciRunState(ci({ status: "completed", conclusion: "failure" }))).toBe("failed");
    expect(ciRunState(ci({ status: "completed", conclusion: "cancelled" }))).toBe("failed");
    expect(ciRunState(ci({ status: "completed", conclusion: "timed_out" }))).toBe("failed");
  });
  it("idle on skipped/neutral/null", () => {
    expect(ciRunState(ci({ status: "completed", conclusion: "skipped" }))).toBe("idle");
    expect(ciRunState(ci({ status: "completed", conclusion: null }))).toBe("idle");
  });
});

describe("ciRunToItem", () => {
  it("determinate progress from steps", () => {
    const item = ciRunToItem(ci({ headSha: "abc", stepsDone: 3, stepsTotal: 6 }), "main");
    expect(item.progress).toEqual({ kind: "determinate", value: 50, label: "3/6 steps" });
    expect(item.id).toBe("ci:abc");
    expect(item.subtitle).toBe("main");
    expect(item.kind).toBe("ci");
  });
  it("indeterminate when running with no steps", () => {
    const item = ciRunToItem(ci({ status: "queued", url: "", stepsTotal: 0 }), "main");
    expect(item.progress).toEqual({ kind: "indeterminate" });
    expect(item.href).toBeUndefined();
  });
  it("null progress when finished with no steps", () => {
    const item = ciRunToItem(ci({ status: "completed", conclusion: "success", stepsTotal: 0 }), "main");
    expect(item.progress).toBeNull();
    expect(item.state).toBe("done");
  });
});

describe("renderDeployState", () => {
  it("maps Render deploy statuses", () => {
    expect(renderDeployState("build_in_progress")).toBe("running");
    expect(renderDeployState("update_in_progress")).toBe("running");
    expect(renderDeployState("live")).toBe("done");
    expect(renderDeployState("update_failed")).toBe("failed");
    expect(renderDeployState("canceled")).toBe("failed");
    expect(renderDeployState("")).toBe("idle");
  });
});

describe("renderServiceToItem", () => {
  it("surfaces a building service as running+indeterminate", () => {
    const item = renderServiceToItem({ id: "s1", name: "api", url: "u", deployStatus: "build_in_progress" });
    expect(item?.state).toBe("running");
    expect(item?.progress).toEqual({ kind: "indeterminate" });
  });
  it("surfaces a failed deploy with null progress", () => {
    const item = renderServiceToItem({ id: "s1", name: "api", url: "u", deployStatus: "update_failed" });
    expect(item?.state).toBe("failed");
    expect(item?.progress).toBeNull();
  });
  it("hides a live (steady-state) service", () => {
    expect(renderServiceToItem({ id: "s1", name: "api", url: "u", deployStatus: "live" })).toBeNull();
  });
});

describe("dockerContainerToItem", () => {
  it("surfaces a restarting/created container", () => {
    expect(dockerContainerToItem({ id: "c1", name: "db", state: "restarting", status: "Restarting" })?.kind).toBe("docker");
    expect(dockerContainerToItem({ id: "c2", name: "db", state: "created", status: "Created" })?.progress).toEqual({
      kind: "indeterminate",
    });
  });
  it("hides a running or exited container", () => {
    expect(dockerContainerToItem({ id: "c1", name: "db", state: "running", status: "Up 3h" })).toBeNull();
    expect(dockerContainerToItem({ id: "c2", name: "db", state: "exited", status: "Exited (0)" })).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/ricardoramos/Projects/airlock && npx vitest run packages/app/src/main/activity.test.ts`
Expected: FAIL ("Cannot find module './activity'").

- [ ] **Step 4: Implement `activity.ts`**

Create `packages/app/src/main/activity.ts` (ASCII-only comments):

```ts
// Activity aggregation: gather in-progress operations (CI, Render, Docker) into
// a single ActivityItem[] for the Activity panel. The pure mappers are TDD'd;
// activityStatus does the I/O (gh + Render + docker) and delegates to them.
// ASCII-only comments: CJS-bundled into the Electron main process.
import { type CiRun, latestCiRun } from "@airlock/agent-core";
import type { ActivityItem } from "../shared/ipc";
import { dockerStatus, gitStatusFor, renderServicesStatus } from "./ide-state";

export function ciRunState(run: CiRun): ActivityItem["state"] {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "done";
  if (run.conclusion === "failure" || run.conclusion === "cancelled" ||
      run.conclusion === "timed_out" || run.conclusion === "action_required" ||
      run.conclusion === "startup_failure" || run.conclusion === "stale") {
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
  if (s.includes("fail") || s.includes("cancel") || s.includes("deactiv")) return "failed";
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

export async function activityStatus(root: string | null): Promise<ActivityItem[]> {
  const items: ActivityItem[] = [];

  // CI (repo-gated): the latest workflow run for the current branch.
  if (root) {
    try {
      const branch = (await gitStatusFor(root)).branch.head;
      if (branch && branch !== "(detached)") {
        const run = await latestCiRun(branch);
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

  return items;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/ricardoramos/Projects/airlock && npx vitest run packages/app/src/main/activity.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the IPC handler**

In `packages/app/src/main/ipc.ts`: add `activityStatus` to the `./activity` import (new import line near the top, after the `./ide-state` import block):

```ts
import { activityStatus } from "./activity";
```

Then register the handler inside `registerIpc`, right after the `docker:list` handler (ipc.ts:495):

```ts
  // activity:status -> ActivityItem[]; NOT requireRoot-gated (render/docker work
  // with no folder; activityStatus skips CI itself when workspaceRoot is null).
  ipcMain.handle("activity:status", () => activityStatus(workspaceRoot));
```

- [ ] **Step 7: Add the preload method**

In `packages/app/src/preload/index.ts`, add near the render/docker methods (preload/index.ts:64-70):

```ts
  activityStatus: () => ipcRenderer.invoke("activity:status"),
```

- [ ] **Step 8: Typecheck + commit**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npx vitest run packages/app/src/main/activity.test.ts`
Expected: clean + PASS.

```bash
git add packages/app/src/main/activity.ts packages/app/src/main/activity.test.ts packages/app/src/shared/ipc.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts
git commit -m "feat(activity): aggregation module + activity:status IPC + shared ActivityItem type"
```

---

## Task 3: The "activity" sidebar section + ActivitySection component (with animations)

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (add `"activity"` to the `Section` union)
- Modify: `packages/app/src/main/prefs.ts` (`SECTIONS` + `DEFAULT_SECTION_VISIBILITY`)
- Modify: `packages/app/src/renderer/src/store.ts` (default `sectionVisibility`)
- Modify: `packages/app/src/main/menu.ts` (`SECTION_LABELS`)
- Modify: `packages/app/src/renderer/src/components/Sidebar.tsx` (import + gated block)
- Create: `packages/app/src/renderer/src/components/ActivitySection.tsx`
- Modify: `packages/app/src/renderer/src/theme.css` (the Activity styles + animations)

> This is the cohesive "Activity panel UI" task: wire the 8th section, build the component (data + polling), and add the full CSS animation vocabulary. The renderer is exempt from the ASCII rule.

- [ ] **Step 1: Add `"activity"` to the `Section` union**

In `packages/app/src/shared/ipc.ts` (the union at ipc.ts:83-91), add the member. Place it after `"git"`:

```ts
export type Section =
  | "files"
  | "secrets"
  | "git"
  | "activity"
  | "databases"
  | "docker"
  | "host"
  | "audit";
```

This `Record<Section, ...>` will now force the two literal maps below (prefs + store) and `SECTION_LABELS` to include `activity` or fail to compile -- the safety net.

- [ ] **Step 2: Update `prefs.ts`**

In `packages/app/src/main/prefs.ts` (SECTIONS at prefs.ts:13-16; DEFAULT at 18-31). Add `"activity"` after `"git"` in the array, and `activity: true` to the map:

```ts
export const SECTIONS: Section[] = [
  "files", "secrets", "git", "activity", "databases", "docker", "host", "audit",
];

const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
  files: true,
  secrets: true,
  git: true,
  activity: true,
  databases: true,
  docker: true,
  host: true,
  audit: true,
};
```

- [ ] **Step 3: Update the renderer store default**

In `packages/app/src/renderer/src/store.ts` (the default `sectionVisibility` at store.ts:146-154), add `activity: true`:

```ts
      sectionVisibility: {
        files: true,
        secrets: true,
        git: true,
        activity: true,
        databases: true,
        docker: true,
        host: true,
        audit: true,
      },
```

- [ ] **Step 4: Update `SECTION_LABELS`**

In `packages/app/src/main/menu.ts` (SECTION_LABELS at menu.ts:5-13), add the label:

```ts
export const SECTION_LABELS: Record<Section, string> = {
  files: "Files",
  secrets: "Secrets",
  git: "Git",
  activity: "Activity",
  databases: "Databases",
  docker: "Docker",
  host: "Host",
  audit: "Audit",
};
```

- [ ] **Step 5: Build the `ActivitySection` component**

Create `packages/app/src/renderer/src/components/ActivitySection.tsx` (renderer -- unicode OK):

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityItem, ActivityStep } from "../../../shared/ipc";

function dotClass(state: ActivityItem["state"]): string {
  if (state === "done") return "status-dot on";
  if (state === "failed") return "status-dot fail";
  if (state === "running") return "status-dot running";
  return "status-dot";
}

function stepIcon(s: ActivityStep): string {
  if (s.status !== "completed") {
    return s.status === "in_progress" ? "codicon-sync step-spin" : "codicon-circle-outline";
  }
  if (s.conclusion === "success") return "codicon-check step-ok";
  if (s.conclusion === "skipped" || s.conclusion === "neutral") return "codicon-dash";
  return "codicon-error step-fail";
}

export function ActivitySection() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const list = await window.airlock.activityStatus();
      if (mounted.current) {
        setItems(list);
        setLoaded(true);
      }
    } catch (err) {
      console.error("activityStatus failed", err);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  // Mount fetch (the section just expanded) + refresh on window focus.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Poll every 3s while something is running; stop when all idle. Collapsing the
  // section unmounts this component, so the timer is torn down automatically.
  const anyRunning = items.some((i) => i.state === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [anyRunning, refresh]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="activity">
      <div className="db-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => void refresh()}
          disabled={busy}
          title="Refresh activity"
        >
          ↻ Refresh
        </button>
      </div>
      {!loaded && <div className="section-note">Loading…</div>}
      {loaded && items.length === 0 && <div className="section-note">Nothing active</div>}
      {items.map((item) => {
        const hasSteps = item.kind === "ci" && (item.steps?.length ?? 0) > 0;
        const isOpen = expanded.has(item.id);
        return (
          <div key={item.id} className="activity-item">
            <div
              className="activity-row"
              role={hasSteps ? "button" : undefined}
              tabIndex={hasSteps ? 0 : undefined}
              onClick={hasSteps ? () => toggle(item.id) : undefined}
              onKeyDown={
                hasSteps
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(item.id);
                      }
                    }
                  : undefined
              }
            >
              <span className={dotClass(item.state)} />
              <span className="activity-title">{item.title}</span>
              <span className="activity-sub">{item.subtitle}</span>
              {item.href && (
                <button
                  type="button"
                  className="activity-link"
                  title="Open on GitHub"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.href) void window.airlock.hostOpenExternal(item.href);
                  }}
                >
                  ↗
                </button>
              )}
            </div>
            {item.progress && (
              <div
                className={
                  item.progress.kind === "indeterminate" ? "progress-bar indeterminate" : "progress-bar"
                }
              >
                <div
                  className="fill"
                  style={
                    item.progress.kind === "determinate" ? { width: `${item.progress.value}%` } : undefined
                  }
                />
              </div>
            )}
            {item.progress?.kind === "determinate" && (
              <div className="activity-progress-label">{item.progress.label}</div>
            )}
            {hasSteps && isOpen && (
              <div className="step-list">
                {item.steps?.map((s, i) => (
                  <div key={`${s.name}-${i}`} className="step-row">
                    <i className={`codicon ${stepIcon(s)}`} />
                    <span className="step-name">{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Wire `ActivitySection` into the Sidebar**

In `packages/app/src/renderer/src/components/Sidebar.tsx`: add the import to the import cluster (Sidebar.tsx:5-13):

```tsx
import { ActivitySection } from "./ActivitySection";
```

Then add the gated block right after the Git block (so Activity sits next to Git, matching the "in the git area" mental model):

```tsx
      {vis.activity && (
        <Section id="activity" title="Activity" defaultOpen={false}>
          <ActivitySection />
        </Section>
      )}
```

- [ ] **Step 7: Add the Activity styles + animations**

Append to the end of `packages/app/src/renderer/src/theme.css` (renderer -- unicode OK; these are the FIRST keyframes + the first `prefers-reduced-motion` block in the app):

```css
/* ---- Activity panel ---- */
.activity {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.activity-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
}
.activity-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--row-h);
  padding: 0 4px;
  border-radius: 4px;
}
.activity-row[role="button"] {
  cursor: pointer;
}
.activity-row:hover {
  background: var(--hover);
}
.activity-title {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-sub {
  font-size: 11px;
  color: var(--fg-dim);
  margin-left: auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-link {
  flex: none;
  margin-left: 4px;
  padding: 0 2px;
  background: none;
  border: none;
  color: var(--fg-dim);
  cursor: pointer;
}
.activity-link:hover {
  color: var(--accent);
}
.activity-progress-label {
  font-size: 10px;
  color: var(--fg-dim);
  padding: 0 4px 2px;
}

/* Progress bar: determinate fill (smooth width) + indeterminate shimmer sweep */
.progress-bar {
  height: 3px;
  margin: 0 4px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
}
.progress-bar .fill {
  height: 100%;
  width: 0;
  background: var(--accent);
  border-radius: 2px;
  transition: width 400ms ease;
}
.progress-bar.indeterminate .fill {
  width: 35%;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: activity-shimmer 1.4s ease-in-out infinite;
}
@keyframes activity-shimmer {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

/* Pulsing dot while running */
.status-dot.running {
  background: var(--accent);
  border-color: var(--accent);
  animation: activity-pulse 1.2s ease-in-out infinite;
}
@keyframes activity-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* CI step checklist */
.step-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0 2px 18px;
}
.step-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 18px;
  font-size: 11px;
  color: var(--fg-dim);
}
.step-row .codicon {
  font-size: 12px;
}
.step-ok {
  color: var(--accent);
}
.step-fail {
  color: #f85149;
}
.step-spin {
  animation: activity-spin 1s linear infinite;
}
@keyframes activity-spin {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress-bar.indeterminate .fill,
  .status-dot.running,
  .step-spin {
    animation: none;
  }
  .progress-bar.indeterminate .fill {
    transform: none;
    width: 100%;
    opacity: 0.5;
  }
}
```

- [ ] **Step 8: Typecheck, test, lint, commit**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint`
Expected: typecheck clean; all tests pass; lint clean.

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/prefs.ts packages/app/src/renderer/src/store.ts packages/app/src/main/menu.ts packages/app/src/renderer/src/components/Sidebar.tsx packages/app/src/renderer/src/components/ActivitySection.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(activity): Activity sidebar section + animated live feed (CI/Render/Docker)"
```

---

## Task 4: Docs + verify + repackage

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-activity-panel-design.md` (status -> v1 complete)
- Modify: `README.md` (mention the Activity panel, if a feature list exists)
- Modify: `packages/app/resources/mcp-docs/sidebar.md` (or the relevant IDE-manual doc that lists sidebar sections -- add "Activity")

- [ ] **Step 1: Update the design spec status**

In `docs/superpowers/specs/2026-06-05-activity-panel-design.md`, change the Status line to `**Status:** v1 complete.`

- [ ] **Step 2: Update the IDE-manual sidebar doc**

Find the MCP resource doc that enumerates sidebar sections (under `packages/app/resources/mcp-docs/`). Add an "Activity" entry describing: a live feed of in-progress operations (CI runs via gh, Render deploys, transitional Docker containers), polled while active, toggleable like the other sections. Keep it accurate to what shipped. If the agent should know it can show/hide it via `set_sidebar_section_visibility`, note that "activity" is a valid section id.

- [ ] **Step 3: Update README (if it lists features)**

If `README.md` has a feature/sidebar list, add a one-line "Activity panel -- live CI/deploy/container progress". Skip if there is no such list (do not invent one).

- [ ] **Step 4: Full verification**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint && npm run build`
Expected: ALL green. Record the test count.

- [ ] **Step 5: Repackage the macOS app**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run package`
Expected: a fresh `.app` builds with no errors (confirm the build timestamp updates).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-06-05-activity-panel-design.md README.md packages/app/resources/mcp-docs/
git commit -m "docs(activity): document the Activity panel; verify + repackage"
```

---

## Self-review notes (carried from spec)

- **No secret value path:** CI/deploy/container status is non-secret metadata; `gh` holds the token; Render uses the existing main-only key. `activity.ts` never calls `getSecretValue`/`getGlobalSecret`.
- **Honest progress:** determinate ONLY for CI steps; indeterminate shimmer for Render building / Docker starting; null when finished with no step detail. No fabricated numbers.
- **Polling discipline:** mount-driven (collapse unmounts -> timer cleared); 3s only while `anyRunning`; focus-refresh when idle; `mounted` ref guards late setState.
- **Section ripple:** the `Section` union edit forces the two maps + labels to compile (the safety net); old `prefs.json` without `activity` defaults to visible via `sanitizeSectionVisibility`.
- **ASCII:** `ci.ts` + `activity.ts` (+ any main/* edits) are ASCII-only; `ActivitySection.tsx` + `theme.css` are renderer (unicode OK).
