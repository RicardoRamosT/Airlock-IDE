import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("airlock", { ready: true });
