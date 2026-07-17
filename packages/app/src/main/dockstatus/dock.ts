// packages/app/src/main/dockstatus/dock.ts
// Paints the macOS dock icon for a DockState. Pure path mapping + a thin,
// platform-guarded setIcon. No-op off macOS.
import path from "node:path";
import { app, nativeImage } from "electron";
import type { DockState } from "./aggregate";

export function dockVariantPath(state: DockState, iconsDir: string): string {
  return path.join(iconsDir, `${state}.png`);
}

let painted: DockState | null = null;

export function paintDock(state: DockState, iconsDir: string): void {
  if (process.platform !== "darwin" || !app.dock) return;
  if (state === painted) return;
  painted = state;
  app.dock.setIcon(
    nativeImage.createFromPath(dockVariantPath(state, iconsDir)),
  );
}

export function resetPainted(): void {
  painted = null;
}
