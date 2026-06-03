import { contextBridge, ipcRenderer } from "electron";
import type { AirlockApi, PtyDataEvent, PtyExitEvent } from "../shared/ipc";

function subscribe<T>(channel: string, cb: (e: T) => void): () => void {
  const handler = (_: unknown, e: T) => cb(e);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: AirlockApi = {
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  listDir: (relPath) => ipcRenderer.invoke("fs:listDir", relPath),
  readFile: (relPath) => ipcRenderer.invoke("fs:readFile", relPath),
  ptyCreate: (cols, rows) => ipcRenderer.invoke("pty:create", cols, rows),
  ptyInput: (id, data) => ipcRenderer.send("pty:input", { id, data }),
  ptyResize: (id, cols, rows) =>
    ipcRenderer.send("pty:resize", { id, cols, rows }),
  onPtyData: (cb) => subscribe<PtyDataEvent>("pty:data", cb),
  onPtyExit: (cb) => subscribe<PtyExitEvent>("pty:exit", cb),
};

contextBridge.exposeInMainWorld("airlock", api);
