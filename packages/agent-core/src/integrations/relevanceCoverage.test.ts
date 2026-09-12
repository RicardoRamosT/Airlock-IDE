// Every gated extension must be DETECTABLE.
//
// Three times in a row this subsystem shipped a declaration with nothing
// feeding it: relevance as a defaulted parameter no call site passed, a
// catalog entry for a file gather.ts never probed, and a SECRET_CATALOG
// pattern fed only by vaulted names. Each was invisible because the unit
// tests exercised the piece rather than the CHAIN.
//
// So this walks the real chain, for the real registries, deriving its fixtures
// from the catalogs rather than hand-writing them: registry -> catalog ->
// buildProfile -> isRelevant. A service whose signal nothing produces fails
// here instead of silently never appearing in anyone's sidebar.
import { describe, expect, it } from "vitest";
import {
  CONFIG_CATALOG,
  DEP_CATALOG,
  LOCKFILE_CATALOG,
  MANIFEST_CATALOG,
  SECRET_CATALOG,
} from "../project-profile/catalog";
import { buildProfile, type DetectInputs } from "../project-profile/detect";
import { CONNECTED_EXTENSIONS } from "./connected";
import { isRelevant, type RelevanceContext } from "./engine";
import type { RelevanceSpec } from "./manifest";
import { INTEGRATIONS } from "./registry";
import { SECTION_EXTENSIONS } from "./sectionExtensions";

type Gated = { id: string; name: string; relevance?: RelevanceSpec };

// Every extension the sidebar gates, from the three real registries. Ids that
// appear twice (Snowflake and Azure are both a manifest and a section
// descriptor) are taken once, preferring the one that declares the spec --
// mergeSectionExtensions lets that row win at runtime.
const ALL: Gated[] = [
  ...INTEGRATIONS,
  ...SECTION_EXTENSIONS,
  ...CONNECTED_EXTENSIONS,
];
const GATED: Gated[] = [
  ...new Map(ALL.filter((d) => d.relevance).map((d) => [d.id, d])).values(),
];

const EMPTY: DetectInputs = {
  root: "/p",
  pkg: null,
  lockfiles: [],
  configFiles: [],
  otherManifests: [],
  secretNames: [],
  envFileNames: [],
  workspaces: null,
  topLevelDirs: [],
  integrationsDetected: [],
  generatedAt: 0,
};

const ctx = (over: Partial<RelevanceContext> = {}): RelevanceContext => ({
  secretNames: [],
  rootFiles: [],
  tech: [],
  gitRemoteHost: null,
  connectedHere: [],
  optedIn: [],
  ...over,
});

const techOf = (i: DetectInputs): string[] => {
  const p = buildProfile(i);
  return [...p.techs, ...p.services].map((t) => t.id);
};

// Every way the shared catalog can produce a given tech id, as a DetectInputs
// that should yield it. Derived from the catalogs, so a new signal is covered
// without editing this file.
function signalsFor(tech: string): { label: string; inputs: DetectInputs }[] {
  const out: { label: string; inputs: DetectInputs }[] = [];
  for (const [dep, e] of Object.entries(DEP_CATALOG))
    if (e.id === tech)
      out.push({
        label: `dependency ${dep}`,
        inputs: { ...EMPTY, pkg: { dependencies: { [dep]: "1.0.0" } } },
      });
  for (const [f, e] of Object.entries(CONFIG_CATALOG))
    if (e.id === tech)
      out.push({
        label: `config file ${f}`,
        inputs: { ...EMPTY, configFiles: [f] },
      });
  for (const [f, e] of Object.entries(LOCKFILE_CATALOG))
    if (e.id === tech)
      out.push({
        label: `lockfile ${f}`,
        inputs: { ...EMPTY, lockfiles: [f] },
      });
  for (const [f, e] of Object.entries(MANIFEST_CATALOG))
    if (e.id === tech)
      out.push({
        label: `manifest ${f}`,
        inputs: { ...EMPTY, otherManifests: [f] },
      });
  for (const s of SECRET_CATALOG)
    if (s.entry.id === tech) {
      // "/^AZURE_/" -> a name that matches it.
      const name = `${s.test.source.replace(/[^A-Z_]/g, "")}KEY`;
      expect(s.test.test(name)).toBe(true);
      out.push({
        label: `vaulted secret ${name}`,
        inputs: { ...EMPTY, secretNames: [name] },
      });
      out.push({
        label: `.env key ${name}`,
        inputs: { ...EMPTY, envFileNames: [name] },
      });
    }
  return out;
}

describe("every gated service is detectable", () => {
  it("gates the services the sidebar actually routes", () => {
    // A guard on the guard: if this list shrinks, the cases below stop running
    // and would still pass.
    expect(GATED.map((d) => d.id).sort()).toEqual([
      "azure",
      "docker",
      "github",
      "neon",
      "render",
      "slack",
      "snowflake",
    ]);
  });

  // The pure "declared but nothing feeds it" check.
  it.each(
    GATED.filter((d) => d.relevance?.tech?.length).map(
      (d) => [d.id, d] as const,
    ),
  )("%s names a tech id the catalog can actually produce", (_id, d) => {
    for (const tech of d.relevance?.tech ?? [])
      expect(
        signalsFor(tech).length,
        `no catalog entry produces "${tech}"`,
      ).toBeGreaterThan(0);
  });

  // ...and the chain end to end, once per real signal.
  it.each(
    GATED.filter((d) => d.relevance?.tech?.length).map(
      (d) => [d.id, d] as const,
    ),
  )("%s turns on from every signal the catalog declares", (_id, d) => {
    for (const tech of d.relevance?.tech ?? [])
      for (const { label, inputs } of signalsFor(tech)) {
        const detected = techOf(inputs);
        expect(detected, `${label} did not detect "${tech}"`).toContain(tech);
        expect(
          isRelevant(d, ctx({ tech: detected })),
          `${label} detected "${tech}" but did not make ${d.id} relevant`,
        ).toBe(true);
      }
  });

  // "At least one signal works" is NOT enough. Azure has three; deleting the
  // AZURE_* pattern left the other two working and every assertion above green
  // -- while silently blinding AirLock to a Python service whose only Azure
  // evidence is a .env key. So the MATRIX is pinned: removing a signal has to
  // be a deliberate edit here, not a silent regression.
  it("keeps the exact signal matrix real projects depend on", () => {
    const matrix = Object.fromEntries(
      GATED.flatMap((d) => d.relevance?.tech ?? []).map((t) => [
        t,
        signalsFor(t)
          .map((s) => s.label)
          .sort(),
      ]),
    );
    expect(matrix).toEqual({
      azure: [
        ".env key AZURE_KEY",
        "config file azure.yaml",
        "dependency @azure/app-configuration",
        "dependency @azure/identity",
        "dependency @azure/storage-blob",
        "vaulted secret AZURE_KEY",
      ],
      // Filename-only on purpose: Docker is not configured by environment.
      docker: [
        "config file Dockerfile",
        "config file compose.yaml",
        "config file compose.yml",
        "config file docker-compose.yaml",
        "config file docker-compose.yml",
      ],
      neon: [
        ".env key NEON_KEY",
        "dependency @neondatabase/serverless",
        "vaulted secret NEON_KEY",
      ],
      render: [
        ".env key RENDER_KEY",
        "config file render.yaml",
        "vaulted secret RENDER_KEY",
      ],
      snowflake: [
        ".env key SNOWFLAKE_KEY",
        "dependency snowflake-sdk",
        "vaulted secret SNOWFLAKE_KEY",
      ],
    });
  });

  // The one that matters for a project that is not an npm app.
  it("detects every env-configured service from a .env key alone", () => {
    for (const id of ["azure", "neon", "render", "snowflake"]) {
      const d = GATED.find((g) => g.id === id) as Gated;
      const key = `${id.toUpperCase()}_API_KEY`;
      const tech = techOf({ ...EMPTY, envFileNames: [key] });
      expect(tech, `.env ${key} did not detect ${id}`).toContain(id);
      expect(
        isRelevant(d, ctx({ tech })),
        `${id} ignored its .env signal`,
      ).toBe(true);
    }
  });

  it("every gated service stays OFF for a project with no signal at all", () => {
    for (const d of GATED)
      expect(isRelevant(d, ctx()), `${d.id} is relevant with no signal`).toBe(
        false,
      );
  });

  it("every gated service can be turned on by hand, so a wrong guess is never a dead end", () => {
    for (const d of GATED)
      expect(
        isRelevant(d, ctx({ optedIn: [d.id] })),
        `${d.id} ignores useHere`,
      ).toBe(true);
  });

  it("every gated service turns on once it is connected here", () => {
    for (const d of GATED)
      expect(
        isRelevant(d, ctx({ connectedHere: [d.id] })),
        `${d.id} ignores being connected`,
      ).toBe(true);
  });
});

describe("the two identities", () => {
  const github = GATED.find((d) => d.id === "github");
  const slack = GATED.find((d) => d.id === "slack");

  it("GitHub follows the origin host, not the code", () => {
    expect(
      isRelevant(github as Gated, ctx({ gitRemoteHost: "github.com" })),
    ).toBe(true);
    expect(
      isRelevant(github as Gated, ctx({ gitRemoteHost: "gitlab.com" })),
    ).toBe(false);
  });

  it("Slack has no automatic signal, by design", () => {
    // Nothing in a repo says "this project uses Slack". `relevance: {}` means
    // gated-with-no-signal, which is NOT the same as declaring none (always on).
    expect(slack?.relevance).toEqual({});
    expect(isRelevant(slack as Gated, ctx({ tech: ["slack"] }))).toBe(false);
    expect(isRelevant(slack as Gated, ctx({ connectedHere: ["slack"] }))).toBe(
      true,
    );
  });
});
