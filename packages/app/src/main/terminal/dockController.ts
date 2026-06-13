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
  // The last script that ran cleanly, for dedupe (see apply()).
  private lastApplied: string | null = null;

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

  // Fire-and-forget: a drag-start must hide immediately without the caller
  // (a synchronous BrowserWindow event handler) awaiting osascript; the settle
  // is awaited in onDragEnd.
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

  // NOTE(concurrency): apply() is not serialized. Rapid signals (resize spam, a
  // drag overlapping a rect update) can interleave osascript calls; the last to
  // land wins. Calls are idempotent against window state and "hide" is issued
  // first on drag, so races are cosmetic and self-correcting for v1. Revisit
  // with a single-flight queue if fast-resize flicker is reported.
  private async apply(): Promise<void> {
    // `|| !this.last` is also the type guard that narrows this.last to non-null
    // for the show branch: dockVisibility can only be "show" when paneShown
    // (= last?.shown) is true, but TS cannot infer that across state(), so the
    // explicit null check is load-bearing, not dead code. In the ternary's else
    // branch TS narrows this.last to non-null for the same reason.
    const script =
      dockVisibility(this.state()) === "hide" || !this.last
        ? hideWindowScript(this.deps.axProcess)
        : setFrameScript(
            this.deps.axProcess,
            paneScreenRect(this.deps.getContentBounds(), this.last.rect),
          );
    // Dedupe: collapses the renderer's per-frame resize reports and repeated
    // drag-hides to a single osascript spawn. Memoize BEFORE the await so an
    // overlapping apply (the fire-and-forget onDragStart racing onDragEnd) reads
    // the current key, not a stale one -- otherwise a fast drag's snap-back gets
    // deduped away and the window stays hidden. On failure clear the key so the
    // next identical apply (a post-open retry) re-runs until the window exists.
    if (script === this.lastApplied) return;
    this.lastApplied = script;
    if (!(await this.safe(script))) this.lastApplied = null;
  }

  // osascript failures (no window yet, permission, etc.) must never crash main.
  // Returns whether the script ran cleanly, so apply() only dedupes successes.
  private async safe(script: string): Promise<boolean> {
    try {
      await this.run(script);
      return true;
    } catch (err) {
      console.error("[dock] osascript failed", err);
      return false;
    }
  }
}
