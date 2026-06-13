import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type DockState,
  type DomRect,
  dockVisibility,
  hideWindowScript,
  paneScreenRect,
  type ScreenRect,
  setFrameScript,
} from "@airlock/agent-core";

const exec = promisify(execFile);

// DI-able osascript runner (mirrors docker.ts). Real one shells out.
export type AppleScriptRunner = (script: string) => Promise<string>;
const realRunner: AppleScriptRunner = async (script) => {
  const { stdout } = await exec("osascript", ["-e", script], { timeout: 4000 });
  return stdout;
};

export interface DockDeps {
  axProcess: string;
  run?: AppleScriptRunner;
  getContentBounds: () => ScreenRect;
}

// Stateful: holds the last pane signal + the live show/hide inputs, and applies
// the pure decision (dockVisibility) via osascript. One per docked terminal.
export class DockController {
  private readonly run: AppleScriptRunner;
  private last: {
    rect: DomRect;
    shown: boolean;
    overlayActive: boolean;
  } | null = null;
  private windowVisible = true;
  private dragging = false;

  constructor(private readonly deps: DockDeps) {
    this.run = deps.run ?? realRunner;
  }

  // Renderer signal (pane rect + shown + overlayActive) changed.
  async update(signal: {
    rect: DomRect;
    shown: boolean;
    overlayActive: boolean;
  }): Promise<void> {
    this.last = signal;
    await this.apply();
  }

  async setWindowVisible(v: boolean): Promise<void> {
    this.windowVisible = v;
    await this.apply();
  }

  onDragStart(): void {
    this.dragging = true;
    void this.apply();
  }

  async onDragEnd(): Promise<void> {
    this.dragging = false;
    await this.apply();
  }

  private state(): DockState {
    return {
      paneShown: this.last?.shown ?? false,
      windowVisible: this.windowVisible,
      overlayActive: this.last?.overlayActive ?? false,
      dragging: this.dragging,
    };
  }

  private async apply(): Promise<void> {
    if (dockVisibility(this.state()) === "hide" || !this.last) {
      await this.safe(hideWindowScript(this.deps.axProcess));
      return;
    }
    const screen = paneScreenRect(this.deps.getContentBounds(), this.last.rect);
    await this.safe(setFrameScript(this.deps.axProcess, screen));
  }

  // osascript failures (no window yet, permission, etc.) must never crash main.
  private async safe(script: string): Promise<void> {
    try {
      await this.run(script);
    } catch (err) {
      console.error("[dock] osascript failed", err);
    }
  }
}
