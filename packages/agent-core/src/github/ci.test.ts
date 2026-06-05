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
