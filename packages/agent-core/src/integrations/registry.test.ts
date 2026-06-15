// packages/agent-core/src/integrations/registry.test.ts
import { describe, expect, it } from "vitest";
import { mapToItems } from "./map";
import { AZURE, INTEGRATIONS, NEON, SNOWFLAKE, VERCEL } from "./registry";

// Captured shape of `vercel ls --json` (trimmed to the fields the manifest reads).
const VERCEL_FIXTURE = {
  deployments: [
    {
      uid: "dpl_1",
      name: "web",
      url: "web-abc.vercel.app",
      readyState: "BUILDING",
      meta: { githubCommitRef: "main" },
    },
    {
      uid: "dpl_2",
      name: "web",
      url: "web-xyz.vercel.app",
      readyState: "READY",
      meta: { githubCommitRef: "main" },
    },
    {
      uid: "dpl_3",
      name: "web",
      url: "web-err.vercel.app",
      readyState: "ERROR",
      meta: { githubCommitRef: "fix-1" },
    },
  ],
};

// Captured shape of `snow sql -q "SHOW WAREHOUSES" --format=json` (trimmed).
const WAREHOUSES = [
  { name: "COMPUTE_WH", state: "STARTED", size: "X-Small" },
  { name: "ETL_WH", state: "SUSPENDED", size: "Small" },
  { name: "LOAD_WH", state: "RESUMING", size: "Medium" },
];

describe("SNOWFLAKE manifest", () => {
  it("is registered and targets the databases view", () => {
    expect(INTEGRATIONS).toContain(SNOWFLAKE);
    expect(SNOWFLAKE.surface).toEqual({ view: "databases" });
  });
  it("maps each warehouse to a row, running for STARTED/RESUMING, idle for SUSPENDED", () => {
    expect(mapToItems(SNOWFLAKE, WAREHOUSES)).toEqual([
      {
        id: "int:snowflake:COMPUTE_WH",
        title: "COMPUTE_WH",
        subtitle: "X-Small",
        state: "running",
      },
      {
        id: "int:snowflake:ETL_WH",
        title: "ETL_WH",
        subtitle: "Small",
        state: "idle",
      },
      {
        id: "int:snowflake:LOAD_WH",
        title: "LOAD_WH",
        subtitle: "Medium",
        state: "running",
      },
    ]);
  });
});

describe("VERCEL manifest", () => {
  it("is registered", () => {
    expect(INTEGRATIONS).toContain(VERCEL);
  });
  it("surfaces an in-progress and a failed deploy, not the ready one", () => {
    expect(mapToItems(VERCEL, VERCEL_FIXTURE)).toEqual([
      {
        id: "int:vercel:dpl_1",
        title: "web",
        subtitle: "main",
        state: "running",
        href: "web-abc.vercel.app",
      },
      {
        id: "int:vercel:dpl_3",
        title: "web",
        subtitle: "fix-1",
        state: "failed",
        href: "web-err.vercel.app",
      },
    ]);
  });
});

// Captured shape of `neonctl projects list --output json` (trimmed). Neon
// projects have no live run state, so each maps to an idle row.
const NEON_PROJECTS = {
  projects: [
    { id: "proj-1", name: "acme-prod", region_id: "aws-us-east-2" },
    { id: "proj-2", name: "acme-dev", region_id: "aws-eu-central-1" },
  ],
};

describe("NEON manifest", () => {
  it("is registered and targets the databases view", () => {
    expect(INTEGRATIONS).toContain(NEON);
    expect(NEON.surface).toEqual({ view: "databases" });
  });
  it("maps each project to an idle row (projects have no live state)", () => {
    expect(mapToItems(NEON, NEON_PROJECTS)).toEqual([
      {
        id: "int:neon:proj-1",
        title: "acme-prod",
        subtitle: "aws-us-east-2",
        state: "idle",
      },
      {
        id: "int:neon:proj-2",
        title: "acme-dev",
        subtitle: "aws-eu-central-1",
        state: "idle",
      },
    ]);
  });
});

// Captured shape of `az webapp list --output json` (trimmed).
const WEBAPPS = [
  { name: "api-prod", state: "Running", resourceGroup: "rg-prod" },
  { name: "web-staging", state: "Stopped", resourceGroup: "rg-staging" },
];

describe("AZURE manifest", () => {
  it("is registered and targets the host view", () => {
    expect(INTEGRATIONS).toContain(AZURE);
    expect(AZURE.surface).toEqual({ view: "host" });
  });
  it("maps each web app to a row, running for Running, idle for Stopped", () => {
    expect(mapToItems(AZURE, WEBAPPS)).toEqual([
      {
        id: "int:azure:api-prod",
        title: "api-prod",
        subtitle: "rg-prod",
        state: "running",
      },
      {
        id: "int:azure:web-staging",
        title: "web-staging",
        subtitle: "rg-staging",
        state: "idle",
      },
    ]);
  });
});

describe("steady manifests carry an install command", () => {
  it("each ships a `brew install` command for the absent-state Install button", () => {
    for (const m of [SNOWFLAKE, NEON, AZURE]) {
      expect(m.install?.command).toMatch(/^brew install /);
    }
  });
});
