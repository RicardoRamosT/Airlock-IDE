import { create } from "zustand";
import type {
  FileContent,
  GitStatus,
  ProjectConfig,
  SecretMeta,
} from "../../shared/ipc";

export interface TerminalEntry {
  id: string; // renderer-side uid (not the pty id)
  title: string;
  renamed: boolean; // user renamed -> OSC title updates stop applying
  ptyId: string | null;
}

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
  maximized: boolean;
  sidebarVisible: boolean; // app-global (persisted), not per-project
  sidebarPosition: "left" | "right"; // app-global (persisted), not per-project
  layoutHydrated: boolean; // default false
  modal: "add-secret" | { update: string } | null;
  diff: {
    path: string;
    which: "staged" | "unstaged";
    original: string;
    modified: string;
  } | null;
  setRoot: (root: string | null) => void;
  setSelected: (relPath: string | null, file: FileContent | null) => void;
  setDiff: (diff: AppState["diff"]) => void;
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
  toggleMaximized: () => void;
  setSidebarVisible: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarPosition: (p: "left" | "right") => void;
  toggleSidebarPosition: () => void;
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
      maximized: false,
      modal: null,
      diff: null,
    }),
  setSelected: (selectedFile, file) => set({ selectedFile, file, diff: null }),
  setDiff: (diff) => set({ diff, selectedFile: null, file: null }),
  setSecrets: (secrets) => set({ secrets }),
  setConfig: (config) => set({ config }),
  setGitStatus: (gitStatus) => set({ gitStatus }),
  setModal: (modal) => set({ modal }),
  terminals: [],
  activeTerminalId: null,
  splitTerminalId: null,
  maximized: false,
  sidebarVisible: true,
  sidebarPosition: "left",
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
  toggleMaximized: () => set((s) => ({ maximized: !s.maximized })),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarPosition: (sidebarPosition) => set({ sidebarPosition }),
  toggleSidebarPosition: () =>
    set((s) => ({
      sidebarPosition: s.sidebarPosition === "left" ? "right" : "left",
    })),
  setLayoutHydrated: (v) => set({ layoutHydrated: v }),
}));
