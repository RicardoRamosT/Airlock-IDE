import type { FC } from "react";
import { SlackSection } from "../components/SlackSection";

// Which component renders an extension's surfaces. An extension ABSENT from
// this map still gets a section -- ExtensionResourcesSection renders its
// granted resources generically (see sidebarViewFor) -- so adding an extension
// needs no wiring here. Only one whose data is not a plain resource list
// (Slack's chat transcript) earns an entry.
export interface ExtensionView {
  Sidebar?: FC;
  Page?: FC; // part 2: the Extensions subpage
}

export const EXTENSION_VIEWS: Record<string, ExtensionView> = {
  slack: { Sidebar: SlackSection },
};

// The bespoke sidebar view for an extension, or null to use the generic one.
export function sidebarViewFor(extId: string): FC | null {
  return EXTENSION_VIEWS[extId]?.Sidebar ?? null;
}
