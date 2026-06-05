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
  // noUncheckedIndexedAccess is on, so arr[0] widens to T | undefined even
  // after the length guard above; ?? null keeps the declared return type.
  return arr[0] ?? null;
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
