// packages/agent-core/src/integrations/sectionExtensions.ts
// Services that own a rail section without being a manifest integration or an
// OAuth "connected" extension.
//
// THE RULE (see the 2026-07-27 design): core is what AirLock authored over your
// own machine; an extension is an adapter over a third-party product you
// separately PROVISION. Git is third-party software too, but there is no
// account and no connect step -- it is ambient. Docker is a product you went
// and installed, which may not be there. That is the line, and it is why these
// six are here while Files and Git are not.
//
// This registry deliberately carries NO behavior. Neon, Docker and Render keep
// their existing main-side code untouched; all that changes is where the UI
// files them. Adding behavior here would be the rewrite this design rejected.
// ASCII-only file.

export interface SectionExtensionDescriptor {
  id: string;
  name: string;
  // Brand glyph id, resolved by the renderer's SectionGlyph. Kept equal to `id`
  // so there is one name to remember per extension.
  icon: string;
  // Which category section shows this as a provider row. Undefined = none
  // (Vercel: its deployments are transient and belong to the Activity feed).
  contributesTo?: "databases" | "host";
  description: string;
  // Limits this extension to projects that use it. Absent = always shown.
  // Snowflake and Azure deliberately have none HERE: they are also manifests,
  // which already declare a spec, and mergeSectionExtensions lets the manifest
  // row win -- a second copy would be a second answer to the same question.
  relevance?: RelevanceSpec;
}

import type { RelevanceSpec } from "./manifest";

export const SECTION_EXTENSIONS: SectionExtensionDescriptor[] = [
  {
    id: "neon",
    name: "Neon",
    icon: "neon",
    contributesTo: "databases",
    description: "Serverless Postgres: projects, branches and databases.",
    // A vaulted NEON_* key. Connecting Neon here also counts (connectedHere),
    // which covers the common case without a file signal existing at all.
    relevance: { envPrefix: "NEON_" },
  },
  {
    id: "docker",
    name: "Docker",
    icon: "docker",
    contributesTo: "databases",
    description: "Local containers, including the databases you run in them.",
    // Docker is MACHINE-wide: without this, a project with no container of its
    // own still listed whatever happened to be running for some other project.
    relevance: {
      files: [
        "Dockerfile",
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
        ".dockerignore",
      ],
    },
  },
  {
    id: "render",
    name: "Render",
    icon: "render",
    contributesTo: "host",
    description: "Deployed services and their latest deploys.",
    relevance: { files: ["render.yaml", "render.json"] },
  },
  {
    id: "snowflake",
    name: "Snowflake",
    icon: "snowflake",
    contributesTo: "databases",
    description: "Warehouses and their state.",
  },
  {
    id: "azure",
    name: "Azure",
    icon: "azure",
    contributesTo: "host",
    description: "Web apps and their running state.",
  },
];

export function sectionExtension(
  id: string,
): SectionExtensionDescriptor | null {
  return SECTION_EXTENSIONS.find((d) => d.id === id) ?? null;
}

// Registry order is the display order, so Databases and Host list providers the
// same way every time rather than however a poll happened to resolve.
export function providersFor(
  view: "databases" | "host",
): SectionExtensionDescriptor[] {
  return SECTION_EXTENSIONS.filter((d) => d.contributesTo === view);
}
