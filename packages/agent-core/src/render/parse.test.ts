import { describe, expect, it } from "vitest";
import {
  normalizeRepoUrl,
  parseDeploys,
  parseLatestDeploy,
  parseServices,
} from "./parse";

describe("parseServices", () => {
  it("unwraps the service envelope and flattens serviceDetails", () => {
    expect(
      parseServices([
        {
          service: {
            id: "srv-1",
            name: "web",
            repo: "https://github.com/o/r",
            branch: "main",
            type: "web_service",
            autoDeploy: "yes",
            dashboardUrl: "https://dashboard.render.com/web/srv-1",
            serviceDetails: {
              url: "https://web.onrender.com",
              region: "oregon",
              plan: "starter",
            },
          },
        },
      ]),
    ).toEqual([
      {
        id: "srv-1",
        name: "web",
        repo: "https://github.com/o/r",
        branch: "main",
        url: "https://web.onrender.com",
        type: "web_service",
        region: "oregon",
        plan: "starter",
        autoDeploy: true,
        dashboardUrl: "https://dashboard.render.com/web/srv-1",
      },
    ]);
  });

  it("maps autoDeploy no -> false and a boolean through unchanged", () => {
    expect(
      parseServices([{ service: { id: "a", autoDeploy: "no" } }])[0],
    ).toMatchObject({ autoDeploy: false });
    expect(
      parseServices([{ service: { id: "b", autoDeploy: true } }])[0],
    ).toMatchObject({ autoDeploy: true });
  });

  it("defaults thin fields (autoDeploy null, strings empty) when absent", () => {
    expect(parseServices([{ service: { id: "srv-1", name: "web" } }])).toEqual([
      {
        id: "srv-1",
        name: "web",
        repo: "",
        branch: "",
        url: "",
        type: "",
        region: "",
        plan: "",
        autoDeploy: null,
        dashboardUrl: "",
      },
    ]);
  });

  it("returns [] when json is not an array", () => {
    expect(parseServices(null)).toEqual([]);
    expect(parseServices({})).toEqual([]);
  });
});

describe("parseLatestDeploy / parseDeploys", () => {
  it("unwraps the deploy envelope, flattens commit, and takes the first message line", () => {
    expect(
      parseLatestDeploy([
        {
          deploy: {
            id: "dep-1",
            status: "live",
            trigger: "api",
            finishedAt: "2026-06-20T10:00:00Z",
            createdAt: "2026-06-20T09:58:00Z",
            commit: {
              id: "abc123",
              message: "fix: cache headers\n\nlonger body here",
            },
          },
        },
      ]),
    ).toEqual({
      id: "dep-1",
      status: "live",
      commit: "abc123",
      message: "fix: cache headers",
      at: "2026-06-20T10:00:00Z",
      trigger: "api",
    });
  });

  it("falls back to createdAt when the deploy has not finished", () => {
    expect(
      parseLatestDeploy([
        { deploy: { id: "d", status: "build_in_progress", createdAt: "T1" } },
      ]),
    ).toMatchObject({ at: "T1", status: "build_in_progress" });
  });

  it("returns null for an empty array", () => {
    expect(parseLatestDeploy([])).toBeNull();
  });

  it("parseDeploys maps every item, newest-first order preserved", () => {
    const out = parseDeploys([
      { deploy: { id: "d2", status: "live", commit: { id: "bbb" } } },
      { deploy: { id: "d1", status: "deactivated", commit: { id: "aaa" } } },
    ]);
    expect(out.map((d) => [d.id, d.status, d.commit])).toEqual([
      ["d2", "live", "bbb"],
      ["d1", "deactivated", "aaa"],
    ]);
  });
});

describe("normalizeRepoUrl", () => {
  it("normalizes https, ssh, and .git-suffixed forms to host/owner/repo lowercase", () => {
    expect(normalizeRepoUrl("https://github.com/Owner/Repo.git")).toBe(
      "github.com/owner/repo",
    );
    expect(normalizeRepoUrl("git@github.com:Owner/Repo.git")).toBe(
      "github.com/owner/repo",
    );
    expect(normalizeRepoUrl("https://github.com/Owner/Repo")).toBe(
      "github.com/owner/repo",
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizeRepoUrl("")).toBe("");
  });
});
