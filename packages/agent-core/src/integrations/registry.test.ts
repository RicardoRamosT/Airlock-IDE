// packages/agent-core/src/integrations/registry.test.ts
import { describe, expect, it } from "vitest";
import { mapToItems } from "./map";
import { AZURE, INTEGRATIONS, SNOWFLAKE, VERCEL } from "./registry";

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

// Captured shape of `az webapp list --output json` (trimmed to the fields the
// manifest maps).
const WEBAPPS = [
  {
    name: "api-prod",
    state: "Running",
    resourceGroup: "rg-prod",
    location: "East US",
    defaultHostName: "api-prod.azurewebsites.net",
    id: "/subscriptions/sub/resourceGroups/rg-prod/providers/Microsoft.Web/sites/api-prod",
  },
  {
    name: "web-staging",
    state: "Stopped",
    resourceGroup: "rg-staging",
    location: "East US",
    defaultHostName: "web-staging.azurewebsites.net",
    id: "/subscriptions/sub/resourceGroups/rg-staging/providers/Microsoft.Web/sites/web-staging",
  },
];

describe("AZURE manifest", () => {
  it("is registered and targets the host view", () => {
    expect(INTEGRATIONS).toContain(AZURE);
    expect(AZURE.surface).toEqual({ view: "host" });
  });
  it("maps each web app to a row, running for Running, idle for Stopped", () => {
    const [prod, staging] = mapToItems(AZURE, WEBAPPS);
    expect(prod).toMatchObject({
      id: "int:azure:api-prod",
      title: "api-prod",
      subtitle: "rg-prod",
      state: "running",
    });
    expect(staging).toMatchObject({
      id: "int:azure:web-staging",
      state: "idle",
    });
  });
  it("surfaces State/Region/URL as expandable details", () => {
    const [prod] = mapToItems(AZURE, WEBAPPS);
    expect(prod?.details).toEqual([
      { label: "State", value: "Running" },
      { label: "Region", value: "East US" },
      { label: "URL", value: "api-prod.azurewebsites.net" },
    ]);
  });
  it("offers a Portal link and state-gated Start/Stop with safe commands", () => {
    const [prod] = mapToItems(AZURE, WEBAPPS);
    expect(prod?.actions?.find((a) => a.label === "Portal")).toEqual({
      label: "Portal",
      icon: "link-external",
      kind: "url",
      target:
        "https://portal.azure.com/#@/resource/subscriptions/sub/resourceGroups/rg-prod/providers/Microsoft.Web/sites/api-prod/overview",
    });
    expect(prod?.actions?.find((a) => a.label === "Stop")).toMatchObject({
      kind: "command",
      target: "az webapp stop --name 'api-prod' --resource-group 'rg-prod'",
      when: ["running"],
    });
    expect(prod?.actions?.find((a) => a.label === "Start")).toMatchObject({
      when: ["idle"],
    });
  });
});

describe("steady manifests carry install + connect commands", () => {
  it("each ships a brew-install and a connect command for the absent/unauthed buttons", () => {
    for (const m of [SNOWFLAKE, AZURE]) {
      expect(m.install?.command).toMatch(/^brew install /);
      expect(m.connect?.command).toBeTruthy();
    }
  });
});
