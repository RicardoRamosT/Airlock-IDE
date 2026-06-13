import { describe, expect, it, vi } from "vitest";
import { DockController } from "./dockController";

const content = { x: 100, y: 80, width: 1400, height: 900 };
const domRect = { left: 220, top: 48, width: 900, height: 700 };

function make() {
  const calls: string[] = [];
  const run = vi.fn((script: string) => {
    calls.push(script);
    return Promise.resolve("");
  });
  // getContentBounds is injected so the controller is testable without Electron.
  const c = new DockController({
    axProcess: "Ghostty",
    run,
    getContentBounds: () => content,
  });
  return { c, calls, run };
}

describe("DockController", () => {
  it("sets the frame when shown, visible, no overlay, not dragging", async () => {
    const { c, calls } = make();
    await c.update({ rect: domRect, shown: true, overlayActive: false });
    // content.x+left=320, content.y+top=128
    expect(calls.at(-1)).toContain("set position of window 1 to {320, 128}");
    expect(calls.at(-1)).toContain("set size of window 1 to {900, 700}");
  });

  it("hides (off-screen) when an overlay is active", async () => {
    const { c, calls } = make();
    await c.update({ rect: domRect, shown: true, overlayActive: true });
    expect(calls.at(-1)).toContain(
      "set position of window 1 to {-32000, -32000}",
    );
  });

  it("hides while dragging and snaps back on settle", async () => {
    const { c, calls, run } = make();
    await c.update({ rect: domRect, shown: true, overlayActive: false });
    c.onDragStart();
    // onDragStart fires apply() without awaiting; one microtask tick flushes it
    // because the mock run() records synchronously before resolving.
    await Promise.resolve();
    expect(calls.at(-1)).toContain("{-32000, -32000}"); // hidden during drag
    run.mockClear();
    await c.onDragEnd(); // settle -> snap to current rect
    expect(calls.at(-1)).toContain("set position of window 1 to {320, 128}");
  });

  it("hides when the pane is not shown / window not visible", async () => {
    const { c, calls } = make();
    await c.update({ rect: domRect, shown: false, overlayActive: false });
    expect(calls.at(-1)).toContain("{-32000, -32000}");
    await c.setWindowVisible(false);
    expect(calls.at(-1)).toContain("{-32000, -32000}");
  });
});
