import { create } from "zustand";
import type { FileContent } from "../../shared/ipc";

interface AppState {
  root: string | null;
  selectedFile: string | null;
  file: FileContent | null;
  setRoot: (root: string | null) => void;
  setSelected: (relPath: string | null, file: FileContent | null) => void;
}

export const useApp = create<AppState>((set) => ({
  root: null,
  selectedFile: null,
  file: null,
  setRoot: (root) => set({ root, selectedFile: null, file: null }),
  setSelected: (selectedFile, file) => set({ selectedFile, file }),
}));
