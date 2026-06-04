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
      const splitTerminalId =
        s.splitTerminalId === id ? null : s.splitTerminalId;
      let activeTerminalId = s.activeTerminalId;
      if (activeTerminalId === id) {
        activeTerminalId = terminals[terminals.length - 1]?.id ?? null;
      }
      return { terminals, splitTerminalId, activeTerminalId };
    }),
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
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
}));
