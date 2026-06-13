// Per-BrowserWindow docked-terminal controllers. Its own module so both ipc.ts
// and window.ts can reach it without a circular import (ipc.ts already imports
// ./window, so window.ts must not import ipc.ts).
import type { DockController } from "./dockController";

const controllers = new Map<number, DockController>();

export function setDockController(id: number, c: DockController): void {
  controllers.set(id, c);
}
export function getDockController(id: number): DockController | undefined {
  return controllers.get(id);
}
export function hasDockController(id: number): boolean {
  return controllers.has(id);
}
export function deleteDockController(id: number): void {
  controllers.delete(id);
}
