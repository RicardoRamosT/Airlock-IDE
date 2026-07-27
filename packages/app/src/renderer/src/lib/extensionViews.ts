import type { FC } from "react";
import { DockerSection } from "../components/DockerSection";
import {
  AzureSection,
  SnowflakeSection,
} from "../components/ManifestExtensionSection";
import { NeonSection } from "../components/NeonSection";
import { RenderSection } from "../components/RenderSection";
import { SlackSection } from "../components/SlackSection";

// Which component renders an extension's surfaces. An extension ABSENT from
// this map still gets a section -- ExtensionResourcesSection renders its
// granted resources generically (see sidebarViewFor) -- but that fallback only
// has data for a Tier-2 CONNECTED_PROVIDERS id (e.g. slack); a manifest id
// (snowflake/azure/vercel) is not one of those, so it MUST have an entry here
// or its rail icon is a permanent dead end (CRITICAL finding, 2026-07-27).
export interface ExtensionView {
  Sidebar?: FC;
  Page?: FC; // part 2: the Extensions subpage
}

export const EXTENSION_VIEWS: Record<string, ExtensionView> = {
  slack: { Sidebar: SlackSection },
  // Moved here from built-in sections: these are third-party services you
  // provision, so they are extensions. Their COMPONENTS are unchanged -- only
  // where the rail files them.
  neon: { Sidebar: NeonSection },
  docker: { Sidebar: DockerSection },
  render: { Sidebar: RenderSection },
  // Manifest-driven extensions: a generic section over integrations:resources,
  // by id (see ManifestExtensionSection.tsx).
  snowflake: { Sidebar: SnowflakeSection },
  azure: { Sidebar: AzureSection },
};

// The bespoke sidebar view for an extension, or null to use the generic one.
export function sidebarViewFor(extId: string): FC | null {
  return EXTENSION_VIEWS[extId]?.Sidebar ?? null;
}
