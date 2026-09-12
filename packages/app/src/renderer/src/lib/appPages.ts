import { APP_PAGES, type AppPage } from "../../../shared/ipc";

// The ONE mapping from store flags to the open IDE page-tabs.
//
// Three surfaces need this list -- the titlebar's "is the project strip
// hidden" test, ProjectTabs' own render, and the MCP layout snapshot -- and
// each used to hand-enumerate it. When the Extensions page-tab was added, two
// of the three were updated and one was not, so `open_app_page("extensions")`
// returned `{open: [], shown: "extensions"}`: a page that rendered in the strip
// while reporting itself closed, and survived close_app_page.
//
// FLAG is typed Record<AppPage, ...>, so adding a fourth page is a COMPILE
// ERROR here rather than a silent omission at one of three call sites.
export type AppPageFlags = {
  settingsTabOpen: boolean;
  usageTabOpen: boolean;
  extensionsTabOpen: boolean;
};

const FLAG: Record<AppPage, keyof AppPageFlags> = {
  settings: "settingsTabOpen",
  usage: "usageTabOpen",
  extensions: "extensionsTabOpen",
};

// Open page-tabs in strip order.
export function openAppPages(f: AppPageFlags): AppPage[] {
  return APP_PAGES.filter((p) => f[FLAG[p]]);
}

export function anyAppPageOpen(f: AppPageFlags): boolean {
  return openAppPages(f).length > 0;
}
