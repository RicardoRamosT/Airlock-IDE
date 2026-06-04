import { create } from "zustand";
import type { FileContent, ProjectConfig, SecretMeta } from "../../shared/ipc";

interface AppState {
  root: string | null;
  selectedFile: string | null;
  file: FileContent | null;
  secrets: SecretMeta[];
  config: ProjectConfig | null;
  termNonce: number;
  modal: "add-secret" | { update: string } | null;
  setRoot: (root: string | null) => void;
  setSelected: (relPath: string | null, file: FileContent | null) => void;
  setSecrets: (secrets: SecretMeta[]) => void;
  setConfig: (config: ProjectConfig | null) => void;
  setModal: (modal: AppState["modal"]) => void;
  restartTerminal: () => void;
}

export const useApp = create<AppState>((set) => ({
  root: null,
  selectedFile: null,
  file: null,
  secrets: [],
  config: null,
  termNonce: 0,
  modal: null,
  setRoot: (root) =>
    set({
      root,
      selectedFile: null,
      file: null,
      secrets: [],
      config: null,
      modal: null,
    }),
  setSelected: (selectedFile, file) => set({ selectedFile, file }),
  setSecrets: (secrets) => set({ secrets }),
  setConfig: (config) => set({ config }),
  setModal: (modal) => set({ modal }),
  restartTerminal: () => set((s) => ({ termNonce: s.termNonce + 1 })),
}));
