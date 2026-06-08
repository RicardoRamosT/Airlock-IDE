// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// Mock the opener so we assert the navigation call without touching the store.
vi.mock("../lib/editorFiles", () => ({
  openEditorFile: vi.fn(),
  closeEditorFile: vi.fn(),
}));

import { openEditorFile } from "../lib/editorFiles";
import { goToDefinition } from "./EditorPane";

const openMock = openEditorFile as unknown as ReturnType<typeof vi.fn>;

describe("goToDefinition", () => {
  it("syncs the document BEFORE asking the server, then opens the target", async () => {
    openMock.mockClear();
    const order: string[] = [];
    const lspDefinition = vi.fn(async () => {
      order.push("definition");
      return { relPath: "src/x.ts", line: 12 };
    });
    (
      window as unknown as { airlock: { lspDefinition: typeof lspDefinition } }
    ).airlock = {
      lspDefinition,
    };
    const sync = vi.fn(async () => {
      order.push("sync");
    });
    // offset 13 is the `x` on line 1 (line 0 is "const x = 1;" + newline at 12),
    // so positionAt -> { line: 1, character: 0 }.
    await goToDefinition("root", "a.ts", "tab1", sync, "const x = 1;\nx", 13);
    expect(order).toEqual(["sync", "definition"]);
    expect(lspDefinition).toHaveBeenCalledWith("root", "a.ts", 1, 0);
    expect(openMock).toHaveBeenCalledWith("tab1", "src/x.ts", 12);
  });

  it("opens nothing when the server returns no definition", async () => {
    openMock.mockClear();
    const lspDefinition = vi.fn(async () => null);
    (
      window as unknown as { airlock: { lspDefinition: typeof lspDefinition } }
    ).airlock = {
      lspDefinition,
    };
    await goToDefinition(
      "root",
      "a.ts",
      "tab1",
      vi.fn(async () => {}),
      "x",
      1,
    );
    expect(openMock).not.toHaveBeenCalled();
  });
});
