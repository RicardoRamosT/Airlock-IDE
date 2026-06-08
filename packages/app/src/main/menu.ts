import { basename, dirname } from "node:path";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";
import type { MenuAction, Section, SectionVisibility } from "../shared/ipc";
import { loadPrefs, SECTIONS, savePrefs } from "./prefs";
import { createWindow } from "./window";

export const SECTION_LABELS: Record<Section, string> = {
  files: "Files",
  secrets: "Secrets",
  git: "Git",
  activity: "Activity",
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

// Pure: the File -> Open Recent rows. One item per folder (basename label,
// full path as sublabel); a disabled placeholder when there are none.
export function recentSubmenuItems(
  recent: string[],
  onPick: (path: string) => void,
): MenuItemConstructorOptions[] {
  if (recent.length === 0) {
    return [{ label: "No Recent Folders", enabled: false }];
  }
  return recent.map((p) => ({
    label: basename(p) || p,
    sublabel: p,
    click: () => onPick(p),
  }));
}

// Push a File-menu command to the renderer. Targets the focused window, falling
// back to the first window, and never sends to a destroyed webContents.
function pushMenuAction(action: MenuAction): void {
  const wc = (
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  )?.webContents;
  if (wc && !wc.isDestroyed()) wc.send("menu:action", action);
}

// tabs mode: New Tab in the focused window (or a new window if none open);
// windows mode: a separate window. createWindow opens with a blank tab.
function newTabOrWindow(openProjectsAsTabs: boolean): void {
  if (openProjectsAsTabs) {
    const win =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.focus();
      win.webContents.send("menu:action", { type: "new-tab" });
      return;
    }
  }
  createWindow();
}

// The File-menu / dock "New" item, relabelled by the openProjectsAsTabs pref:
// "New Tab" (Cmd+T) in tabs mode, "New Window" (Cmd+Shift+N) in windows mode.
export function newMenuItem(
  openProjectsAsTabs: boolean,
): MenuItemConstructorOptions {
  return openProjectsAsTabs
    ? {
        label: "New Tab",
        accelerator: "CmdOrCtrl+T",
        click: () => newTabOrWindow(true),
      }
    : {
        label: "New Window",
        accelerator: "CmdOrCtrl+Shift+N",
        click: () => createWindow(),
      };
}

// Build + install the application menu. setApplicationMenu replaces the
// default wholesale, so standard roles are re-declared to keep Reload / Zoom /
// Full Screen / copy-paste. View also carries the Sidebar submenu.
export function applyAppMenu(
  prefsFile: string,
  visibility: SectionVisibility,
  recentFolders: string[],
  openProjectsAsTabs: boolean,
): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        newMenuItem(openProjectsAsTabs),
        { type: "separator" },
        {
          label: "Open Folder...",
          accelerator: "CmdOrCtrl+O",
          click: () => pushMenuAction({ type: "open-folder" }),
        },
        {
          label: "Open File...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => pushMenuAction({ type: "open-file" }),
        },
        {
          label: "Open Recent",
          submenu: recentSubmenuItems(recentFolders, (path) =>
            pushMenuAction({ type: "open-recent", path }),
          ),
        },
        { type: "separator" },
        {
          label: "Close Editor",
          accelerator: "CmdOrCtrl+W",
          click: () => pushMenuAction({ type: "close-editor" }),
        },
        {
          label: "Close Folder",
          click: () => pushMenuAction({ type: "close-folder" }),
        },
        { type: "separator" },
        { role: "close", accelerator: "CmdOrCtrl+Shift+W" },
      ],
    },
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
    {
      label: "Go",
      submenu: [
        {
          label: "Go to File...",
          accelerator: "CmdOrCtrl+P",
          click: () => pushMenuAction({ type: "quick-open" }),
        },
        {
          label: "Command Palette...",
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => pushMenuAction({ type: "command-palette" }),
        },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Clicking a recent opens it in the focused window via the normal open-recent
// renderer path (workspaceOpen sets main root + recents + MCP, then
// openPickedFolder opens it as a tab / fills a blank tab / replaces per mode).
// If no window is open, create one and open the folder once it has loaded.
function openRecentFromDock(path: string, _openProjectsAsTabs: boolean): void {
  const existing =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    existing.webContents.send("menu:action", { type: "open-recent", path });
    return;
  }
  const win = createWindow();
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed())
      win.webContents.send("menu:action", { type: "open-recent", path });
  });
}

// Build the dock menu template: recent projects (most-recent-first) then the
// New Tab/New Window item. Labels are the folder basename; on a basename
// collision the colliding entries are disambiguated with their parent dir.
export function buildDockTemplate(
  openProjectsAsTabs: boolean,
  recentFolders: string[],
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const counts = new Map<string, number>();
  for (const p of recentFolders) {
    const b = basename(p);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  for (const p of recentFolders) {
    const b = basename(p);
    const label =
      (counts.get(b) ?? 0) > 1 ? `${b} - ${basename(dirname(p))}` : b;
    items.push({
      label,
      click: () => openRecentFromDock(p, openProjectsAsTabs),
    });
  }
  if (items.length > 0) items.push({ type: "separator" });
  items.push(newMenuItem(openProjectsAsTabs));
  return items;
}

// Build + install the macOS dock right-click menu: recent projects, a separator,
// then the New item (relabelled by the pref). No-op off darwin (app.dock only
// exists on macOS).
export function applyDockMenu(
  openProjectsAsTabs: boolean,
  recentFolders: string[],
): void {
  if (process.platform !== "darwin") return;
  app.dock?.setMenu(
    Menu.buildFromTemplate(
      buildDockTemplate(openProjectsAsTabs, recentFolders),
    ),
  );
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
  applyAppMenu(prefsFile, next, cur.recentFolders, cur.openProjectsAsTabs);
  // Sidebar visibility is app-global, so fan the new map out to every window.
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed())
      w.webContents.send("sections:changed", next);
  }
  return next;
}
