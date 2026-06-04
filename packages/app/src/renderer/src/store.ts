import { create } from "zustand";
import type {
  FileContent,
  GitStatus,
  ProjectConfig,
  SecretMeta,
} from "../../shared/ipc";

interface AppState {
  root: string | null;
  selectedFile: string | null;
  file: FileContent | null;
  secrets: SecretMeta[];
  config: ProjectConfig | null;
  gitStatus: GitStatus | null;
  termNonce: number;
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
  restartTerminal: () => void;
}

export const useApp = create<AppState>((set) => ({
  root: null,
  selectedFile: null,
  file: null,
  secrets: [],
  config: null,
  gitStatus: null,
  termNonce: 0,
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
      modal: null,
      diff: null,
    }),
  setSelected: (selectedFile, file) => set({ selectedFile, file, diff: null }),
  setDiff: (diff) => set({ diff, selectedFile: null, file: null }),
  setSecrets: (secrets) => set({ secrets }),
  setConfig: (config) => set({ config }),
  setGitStatus: (gitStatus) => set({ gitStatus }),
  setModal: (modal) => set({ modal }),
  restartTerminal: () => set((s) => ({ termNonce: s.termNonce + 1 })),
}));
