import { describe, expect, it } from "vitest";
import { normalizeRepoUrl, parseLatestDeploy, parseServices } from "./parse";

describe("parseServices", () => {
  it("unwraps the service envelope and flattens serviceDetails.url", () => {
    expect(
      parseServices([
        {
          service: {
            id: "srv-1",
            name: "web",
            repo: "https://github.com/o/r",
            branch: "main",
            serviceDetails: { url: "https://web.onrender.com" },
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
      },
    ]);
  });

  it("tolerates a bare item with no service envelope", () => {
    expect(
      parseServices([
        {
          id: "srv-1",
          name: "web",
          repo: "https://github.com/o/r",
          branch: "main",
          serviceDetails: { url: "https://web.onrender.com" },
        },
      ]),
    ).toEqual([
      {
        id: "srv-1",
        name: "web",
        repo: "https://github.com/o/r",
        branch: "main",
        url: "https://web.onrender.com",
      },
    ]);
  });

  it("defaults url to empty string when serviceDetails is missing", () => {
    expect(parseServices([{ service: { id: "srv-1", name: "web" } }])).toEqual([
      { id: "srv-1", name: "web", repo: "", branch: "", url: "" },
    ]);
  });

  it("returns [] when json is not an array", () => {
    expect(parseServices(null)).toEqual([]);
    expect(parseServices({})).toEqual([]);
  });
});

describe("parseLatestDeploy", () => {
  it("unwraps the deploy envelope and flattens commit.id", () => {
    expect(
      parseLatestDeploy([
        { deploy: { status: "live", commit: { id: "abc123" } } },
      ]),
    ).toEqual({ status: "live", commit: "abc123" });
  });

  it("tolerates a bare item with no deploy envelope", () => {
    expect(
      parseLatestDeploy([{ status: "live", commit: { id: "abc123" } }]),
    ).toEqual({ status: "live", commit: "abc123" });
  });

  it("returns null for an empty array", () => {
    expect(parseLatestDeploy([])).toBeNull();
  });

  it("defaults commit to empty string when commit is missing", () => {
    expect(parseLatestDeploy([{ deploy: { status: "live" } }])).toEqual({
      status: "live",
      commit: "",
    });
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
