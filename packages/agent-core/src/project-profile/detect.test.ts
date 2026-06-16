import { describe, expect, it } from "vitest";
import { buildProfile, type DetectInputs } from "./detect";

const base: DetectInputs = {
  root: "/p",
  pkg: null,
  lockfiles: [],
  configFiles: [],
  otherManifests: [],
  secretNames: [],
  workspaces: null,
  topLevelDirs: [],
  integrationsDetected: [],
  generatedAt: 1,
};

describe("buildProfile", () => {
  it("maps dependencies (with version) into techs", () => {
    const p = buildProfile({
      ...base,
      pkg: {
        dependencies: { react: "^18.2.0" },
        devDependencies: { vite: "5.0.0" },
      },
    });
    const react = p.techs.find((t) => t.id === "react");
    expect(react).toMatchObject({
      name: "React",
      category: "framework",
      version: "^18.2.0",
    });
    expect(react?.sources).toEqual(["package.json"]);
    expect(p.techs.some((t) => t.id === "vite")).toBe(true);
  });

  it("maps config-file fingerprints into the right bucket", () => {
    const p = buildProfile({
      ...base,
      configFiles: ["wrangler.toml", "biome.json"],
    });
    expect(p.services.find((s) => s.id === "cloudflare")?.sources).toEqual([
      "wrangler.toml",
    ]);
    expect(p.techs.some((t) => t.id === "biome")).toBe(true);
  });

  it("maps high-signal secret names into services; ignores generic names", () => {
    const p = buildProfile({
      ...base,
      secretNames: ["CLERK_SECRET_KEY", "STRIPE_API_KEY", "API_KEY", "TOKEN"],
    });
    expect(p.services.find((s) => s.id === "clerk")?.sources).toEqual([
      "secret: CLERK_SECRET_KEY",
    ]);
    expect(p.services.some((s) => s.id === "stripe")).toBe(true);
    expect(p.techs.length + p.services.length).toBe(2);
  });

  it("dedupes one id across signals and merges sources", () => {
    const p = buildProfile({
      ...base,
      pkg: { dependencies: { "@clerk/nextjs": "5.0.0" } },
      secretNames: ["CLERK_SECRET_KEY"],
    });
    const clerk = p.services.filter((s) => s.id === "clerk");
    expect(clerk).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    expect(clerk[0]!.sources.sort()).toEqual([
      "package.json",
      "secret: CLERK_SECRET_KEY",
    ]);
  });

  it("derives the package manager from the lockfile", () => {
    const p = buildProfile({ ...base, lockfiles: ["pnpm-lock.yaml"] });
    expect(p.techs.find((t) => t.id === "pnpm")).toMatchObject({
      category: "packageManager",
    });
  });

  it("maps non-JS manifests to languages", () => {
    const p = buildProfile({
      ...base,
      otherManifests: ["go.mod", "Cargo.toml"],
    });
    expect(p.techs.map((t) => t.id).sort()).toEqual(["go", "rust"]);
  });

  it("seeds areas from workspaces when present, else top-level dirs", () => {
    expect(
      buildProfile({ ...base, workspaces: ["packages/a", "packages/b"] }).areas,
    ).toEqual([
      { name: "packages/a", path: "packages/a" },
      { name: "packages/b", path: "packages/b" },
    ]);
    expect(
      buildProfile({ ...base, topLevelDirs: ["src", "server"] }).areas,
    ).toEqual([
      { name: "src", path: "src" },
      { name: "server", path: "server" },
    ]);
  });

  it("is stable: techs/services sorted by category then name; carries root + generatedAt", () => {
    const p = buildProfile({
      ...base,
      root: "/x",
      generatedAt: 42,
      pkg: { dependencies: { vite: "1", react: "1" } },
    });
    expect(p.root).toBe("/x");
    expect(p.generatedAt).toBe(42);
    expect(p.techs.map((t) => t.id)).toEqual(["vite", "react"]);
  });

  it("handles a fully empty project without throwing", () => {
    const p = buildProfile(base);
    expect(p).toMatchObject({ techs: [], services: [], areas: [] });
  });
});
