import type { DirEntry, FileContent } from "@airlock/agent-core";

export type { DirEntry, FileContent };

export interface PtyDataEvent {
  id: string;
  data: string;
}

export interface PtyExitEvent {
  id: string;
  exitCode: number;
}

/** Exposed on window.airlock by the preload script. */
export interface AirlockApi {
  openFolder(): Promise<string | null>;
  listDir(relPath: string): Promise<DirEntry[]>;
  readFile(relPath: string): Promise<FileContent>;
  ptyCreate(cols: number, rows: number): Promise<string>;
  ptyInput(id: string, data: string): void;
  ptyResize(id: string, cols: number, rows: number): void;
  onPtyData(cb: (e: PtyDataEvent) => void): () => void;
  onPtyExit(cb: (e: PtyExitEvent) => void): () => void;
}
