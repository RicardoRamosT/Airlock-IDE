import { create } from "zustand";
import type {
  FileContent,
  GitStatus,
  ProjectConfig,
  SecretMeta,
  SectionVisibility,
} from "../../shared/ipc";

export interface TerminalEntry {
  id: string; // renderer-side uid (not the pty id)
  title: string;
  renamed: boolean; // user renamed -> OSC title updates stop applying
  ptyId: string | null;
}

export type DbView =
  | { kind: "secret"; id: string; schema: string; table: string }
  | {
      kind: "neon";
      projectId: string;
      branchId: string;
      database: string;
      role: string;
      schema: string;
      table: string;
    };

let termCounter = 0;
const newEntry = (): TerminalEntry => ({
  id: `term-${++termCounter}`,
  title: "zsh",
  renamed: false,
  ptyId: null,
});

interface AppState {
  root: string | null;
  selectedFile: string | null;
  file: FileContent | null;
  secrets: SecretMeta[];
  config: ProjectConfig | null;
  gitStatus: GitStatus | null;
  terminals: TerminalEntry[];
  activeTerminalId: string | null;
  splitTerminalId: string | null; // second visible pane; null = no split
  sidebarVisible: boolean; // app-global (persisted), not per-project
  sidebarPosition: "left" | "right"; // app-global (persisted), not per-project
  theme: "dark" | "light"; // app-global (persisted), drives data-theme on <html>
  clipboardClearSeconds: number; // app-global (persisted), seconds before clipboard auto-clears (0 = never)
  sectionVisibility: SectionVisibility; // app-global (persisted), gates sidebar sections
  settingsOpen: boolean; // Settings tab shown in viewer-pane (excludes file/diff)
  // A vaulted DB table being browsed in the viewer-pane. Like settingsOpen and
  // file/diff this is part of the viewer-pane discriminator: only one of
  // file/diff/settings/dbView is non-null at a time (mutual exclusion).
  dbView: DbView | null;
  layoutHydrated: boolean; // default false
  modal:
    | "add-secret"
    | { update: string }
    | {
        requestSecret: {
          requestId: string;
          name: string;
          providerHint?: string;
        };
      }
    | "connect-neon"
    | "connect-render"
    | null;
  diff: {
    path: string;
    which: "staged" | "unstaged";
    original: string;
    modified: string;
  } | null;
  setRoot: (root: string | null) => void;
  setSelected: (relPath: string | null, file: FileContent | null) => void;
  setDiff: (diff: AppState["diff"]) => void;
  setDbView: (v: DbView | null) => void;
  setSecrets: (secrets: SecretMeta[]) => void;
  setConfig: (config: ProjectConfig | null) => void;
  setGitStatus: (gitStatus: GitStatus | null) => void;
  setModal: (modal: AppState["modal"]) => void;
  addTerminal: () => string; // returns new id, sets active
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  setTerminalPty: (id: string, ptyId: string) => void;
  setTerminalTitle: (id: string, title: string, fromUser: boolean) => void;
  setSplit: (id: string | null) => void;
  setSidebarVisible: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarPosition: (p: "left" | "right") => void;
  toggleSidebarPosition: () => void;
  setTheme: (t: "dark" | "light") => void;
  setClipboardClearSeconds: (n: number) => void;
  setSectionVisibility: (v: SectionVisibility) => void;
  setSettingsOpen: (v: boolean) => void;
  setLayoutHydrated: (v: boolean) => void;
}

export const useApp = create<AppState>((set) => ({
  root: null,
  selectedFile: null,
  file: null,
  secrets: [],
  config: null,
  gitStatus: null,
  modal: null,
  diff: null,
  dbView: null,
  setRoot: (root) =>
    set({
      root,
      selectedFile: null,
      file: null,
      secrets: [],
      config: null,
      gitStatus: null,
      terminals: [],
      activeTerminalId: null,
      splitTerminalId: null,
      modal: null,
      diff: null,
      settingsOpen: false,
      dbView: null,
    }),
  setSelected: (selectedFile, file) =>
    set({ selectedFile, file, diff: null, settingsOpen: false, dbView: null }),
  setDiff: (diff) =>
    set({
      diff,
      selectedFile: null,
      file: null,
      settingsOpen: false,
      dbView: null,
    }),
  setSecrets: (secrets) => set({ secrets }),
  setConfig: (config) => set({ config }),
  setGitStatus: (gitStatus) => set({ gitStatus }),
  setModal: (modal) => set({ modal }),
  terminals: [],
  activeTerminalId: null,
  splitTerminalId: null,
  sidebarVisible: true,
  sidebarPosition: "left",
  theme: "dark",
  clipboardClearSeconds: 30,
  sectionVisibility: {
    files: true,
    secrets: true,
    git: true,
    activity: true,
    databases: true,
    docker: true,
    host: true,
    audit: true,
  },
  settingsOpen: false,
  layoutHydrated: false,
  addTerminal: () => {
    const entry = newEntry();
    set((s) => ({
      terminals: [...s.terminals, entry],
      activeTerminalId: entry.id,
    }));
    return entry.id;
  },
  removeTerminal: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      let splitTerminalId = s.splitTerminalId === id ? null : s.splitTerminalId;
      let activeTerminalId = s.activeTerminalId;
      if (activeTerminalId === id) {
        activeTerminalId = terminals[terminals.length - 1]?.id ?? null;
      }
      // Closing the active pane while split can promote the split pane to
      // active (it is the last remaining tab). The same terminal must never
      // occupy both slots — that leaves a blank second column — so collapse
      // the split when active and split would coincide.
      if (splitTerminalId !== null && splitTerminalId === activeTerminalId) {
        splitTerminalId = null;
      }
      return { terminals, splitTerminalId, activeTerminalId };
    }),
  setActiveTerminal: (id) =>
    set((s) => {
      // Clicking the tab that is currently in the split slot swaps the two
      // slots: the split pane becomes active and the previous active pane
      // moves into the split slot. Both stay visible. For any other tab we
      // just promote it to active (leaving the split slot untouched).
      if (id === s.splitTerminalId) {
        return { activeTerminalId: id, splitTerminalId: s.activeTerminalId };
      }
      return { activeTerminalId: id };
    }),
  setTerminalPty: (id, ptyId) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, ptyId } : t)),
    })),
  setTerminalTitle: (id, title, fromUser) =>
    set((s) => ({
      terminals: s.terminals.map((t) => {
        if (t.id !== id) return t;
        if (!fromUser && t.renamed) return t;
        return { ...t, title, renamed: fromUser ? true : t.renamed };
      }),
    })),
  setSplit: (id) => set({ splitTerminalId: id }),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarPosition: (sidebarPosition) => set({ sidebarPosition }),
  toggleSidebarPosition: () =>
    set((s) => ({
      sidebarPosition: s.sidebarPosition === "left" ? "right" : "left",
    })),
  setTheme: (theme) => set({ theme }),
  setClipboardClearSeconds: (clipboardClearSeconds) =>
    set({ clipboardClearSeconds }),
  setSectionVisibility: (sectionVisibility) => set({ sectionVisibility }),
  // Opening Settings clears the file/diff/dbView so the viewer-pane shows only
  // one thing at a time (mutual exclusion). Closing leaves the rest untouched.
  setSettingsOpen: (v) =>
    set({
      settingsOpen: v,
      ...(v
        ? { selectedFile: null, file: null, diff: null, dbView: null }
        : {}),
    }),
  // Browsing a DB table clears file/diff/settings (mutual exclusion), exactly
  // like setSettingsOpen. Passing null closes the data grid (back to terminal).
  setDbView: (v) =>
    set({
      dbView: v,
      ...(v
        ? { selectedFile: null, file: null, diff: null, settingsOpen: false }
        : {}),
    }),
  setLayoutHydrated: (v) => set({ layoutHydrated: v }),
}));
