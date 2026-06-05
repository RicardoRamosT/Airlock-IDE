import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import type { Section, SectionVisibility } from "../shared/ipc";
import { loadPrefs, SECTIONS, savePrefs } from "./prefs";

const SECTION_LABELS: Record<Section, string> = {
  files: "Files",
  secrets: "Secrets",
  git: "Git",
  databases: "Databases",
  docker: "Docker",
  host: "Host",
  audit: "Audit",
};

// Pure: the View -> Sidebar checkbox rows. Tested without Electron.
export function sectionSubmenuItems(
  visibility: SectionVisibility,
  onToggle: (id: Section, visible: boolean) => void,
): MenuItemConstructorOptions[] {
  return SECTIONS.map((id) => ({
    label: SECTION_LABELS[id],
    type: "checkbox",
    checked: visibility[id] !== false,
    click: (item) => onToggle(id, item.checked),
  }));
}

// Build + install the application menu. setApplicationMenu replaces the
// default wholesale, so standard roles are re-declared to keep Reload / Zoom /
// Full Screen / copy-paste. View also carries the Sidebar submenu.
export function applyAppMenu(
  prefsFile: string,
  visibility: SectionVisibility,
): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          label: "Sidebar",
          submenu: sectionSubmenuItems(visibility, (id, vis) => {
            void changeSectionVisibility(prefsFile, id, vis);
          }),
        },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The single funnel for a visibility change, from the menu OR (Task 3) the
// renderer. Writes the complete map, rebuilds the menu so checkmarks track,
// and pushes the authoritative map to the renderer.
export async function changeSectionVisibility(
  prefsFile: string,
  id: Section,
  visible: boolean,
): Promise<SectionVisibility> {
  const cur = await loadPrefs(prefsFile);
  const next: SectionVisibility = { ...cur.sectionVisibility, [id]: visible };
  await savePrefs(prefsFile, { sectionVisibility: next });
  applyAppMenu(prefsFile, next);
  const wc = BrowserWindow.getAllWindows()[0]?.webContents;
  if (wc && !wc.isDestroyed()) wc.send("sections:changed", next);
  return next;
}
