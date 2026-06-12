import { describe, expect, it } from "vitest";
import { type TermKeyEvent, terminalKeyBytes } from "./terminalKeys";

// Build a key event with all modifiers off, then override.
const ev = (over: Partial<TermKeyEvent> & { key: string }): TermKeyEvent => ({
  shiftKey: false,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  ...over,
});

describe("terminalKeyBytes", () => {
  it("maps Shift+Enter to a newline (ESC CR)", () => {
    expect(terminalKeyBytes(ev({ key: "Enter", shiftKey: true }))).toBe(
      "\x1b\r",
    );
  });

  it("maps Cmd+Arrow to line start/end (Ctrl-A / Ctrl-E)", () => {
    expect(terminalKeyBytes(ev({ key: "ArrowLeft", metaKey: true }))).toBe(
      "\x01",
    );
    expect(terminalKeyBytes(ev({ key: "ArrowRight", metaKey: true }))).toBe(
      "\x05",
    );
  });

  it("maps Option+Arrow to word back/forward (Meta-b / Meta-f)", () => {
    expect(terminalKeyBytes(ev({ key: "ArrowLeft", altKey: true }))).toBe(
      "\x1bb",
    );
    expect(terminalKeyBytes(ev({ key: "ArrowRight", altKey: true }))).toBe(
      "\x1bf",
    );
  });

  it("maps Cmd/Option+Backspace to kill line-start / prev-word", () => {
    expect(terminalKeyBytes(ev({ key: "Backspace", metaKey: true }))).toBe(
      "\x15",
    );
    expect(terminalKeyBytes(ev({ key: "Backspace", altKey: true }))).toBe(
      "\x1b\x7f",
    );
  });

  it("maps Cmd/Option+Delete to kill line-end / next-word", () => {
    expect(terminalKeyBytes(ev({ key: "Delete", metaKey: true }))).toBe("\x0b");
    expect(terminalKeyBytes(ev({ key: "Delete", altKey: true }))).toBe("\x1bd");
  });

  it("returns null for keys it should not touch", () => {
    expect(terminalKeyBytes(ev({ key: "Enter" }))).toBeNull(); // plain Enter
    expect(terminalKeyBytes(ev({ key: "a" }))).toBeNull(); // plain letter
    expect(terminalKeyBytes(ev({ key: "ArrowLeft" }))).toBeNull(); // plain arrow
    expect(terminalKeyBytes(ev({ key: "c", metaKey: true }))).toBeNull(); // Cmd+C copy
    expect(terminalKeyBytes(ev({ key: "e", altKey: true }))).toBeNull(); // Option+letter
  });

  it("requires EXACT modifiers (extra modifiers -> null)", () => {
    expect(
      terminalKeyBytes(ev({ key: "ArrowLeft", metaKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      terminalKeyBytes(ev({ key: "Enter", shiftKey: true, metaKey: true })),
    ).toBeNull();
    // Ctrl chords pass through natively (the user types Ctrl-A/E/U/K directly).
    expect(
      terminalKeyBytes(ev({ key: "ArrowLeft", ctrlKey: true })),
    ).toBeNull();
  });
});
