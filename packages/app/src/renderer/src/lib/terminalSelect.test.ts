import { describe, expect, it } from "vitest";
import type { TermKeyEvent } from "./terminalKeys";
import {
  keepsSelection,
  nextWord,
  planSelection,
  prevWord,
  terminalSelectChord,
} from "./terminalSelect";

const ev = (over: Partial<TermKeyEvent>): TermKeyEvent => ({
  key: "ArrowLeft",
  shiftKey: false,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  ...over,
});

describe("terminalSelectChord", () => {
  it("classifies the four selection chords", () => {
    expect(
      terminalSelectChord(
        ev({ metaKey: true, shiftKey: true, key: "ArrowLeft" }),
      ),
    ).toBe("lineStart");
    expect(
      terminalSelectChord(
        ev({ metaKey: true, shiftKey: true, key: "ArrowRight" }),
      ),
    ).toBe("lineEnd");
    expect(
      terminalSelectChord(
        ev({ altKey: true, shiftKey: true, key: "ArrowLeft" }),
      ),
    ).toBe("wordLeft");
    expect(
      terminalSelectChord(
        ev({ altKey: true, shiftKey: true, key: "ArrowRight" }),
      ),
    ).toBe("wordRight");
  });

  it("returns null without shift, with extra modifiers, or for non-arrows", () => {
    expect(
      terminalSelectChord(ev({ metaKey: true, key: "ArrowLeft" })),
    ).toBeNull();
    expect(
      terminalSelectChord(ev({ altKey: true, key: "ArrowRight" })),
    ).toBeNull();
    expect(
      terminalSelectChord(
        ev({ metaKey: true, shiftKey: true, ctrlKey: true, key: "ArrowLeft" }),
      ),
    ).toBeNull();
    expect(
      terminalSelectChord(
        ev({ metaKey: true, altKey: true, shiftKey: true, key: "ArrowLeft" }),
      ),
    ).toBeNull();
    expect(
      terminalSelectChord(ev({ metaKey: true, shiftKey: true, key: "a" })),
    ).toBeNull();
  });
});

describe("prevWord / nextWord ([A-Za-z0-9_] words)", () => {
  const t = "git commit -m";
  it("prevWord lands at the start of the word to the left", () => {
    expect(prevWord(t, 13)).toBe(12);
    expect(prevWord(t, 12)).toBe(4);
    expect(prevWord(t, 10)).toBe(4);
    expect(prevWord(t, 2)).toBe(0);
    expect(prevWord(t, 0)).toBe(0);
  });
  it("nextWord lands just past the word to the right", () => {
    expect(nextWord(t, 0)).toBe(3);
    expect(nextWord(t, 3)).toBe(10);
    expect(nextWord(t, 10)).toBe(13);
    expect(nextWord(t, 13)).toBe(13);
  });
  it("treats underscores and digits as word chars", () => {
    expect(nextWord("a_b2 cd", 0)).toBe(4);
    expect(prevWord("a_b2 cd", 4)).toBe(0);
  });
});

describe("planSelection", () => {
  const base = {
    cursorCol: 4,
    lineLen: 13,
    lineText: "git commit -m",
    anchor: null,
    activeEnd: null,
  };
  it("starts a fresh selection anchored at the cursor", () => {
    expect(planSelection(base, "lineStart")).toEqual({
      anchor: 4,
      activeEnd: 0,
    });
    expect(planSelection(base, "lineEnd")).toEqual({
      anchor: 4,
      activeEnd: 13,
    });
    expect(planSelection(base, "wordRight")).toEqual({
      anchor: 4,
      activeEnd: 10,
    });
    expect(planSelection(base, "wordLeft")).toEqual({
      anchor: 4,
      activeEnd: 0,
    });
  });
  it("extends from the existing active end, keeping the anchor", () => {
    const s = { ...base, anchor: 4, activeEnd: 10 };
    expect(planSelection(s, "wordRight")).toEqual({ anchor: 4, activeEnd: 13 });
    expect(planSelection(s, "wordLeft")).toEqual({ anchor: 4, activeEnd: 4 });
  });
  it("can flip across the anchor", () => {
    const s = { ...base, cursorCol: 4, anchor: 4, activeEnd: 0 };
    expect(planSelection(s, "lineEnd")).toEqual({ anchor: 4, activeEnd: 13 });
  });
});

describe("keepsSelection", () => {
  it("preserves the selection for bare modifiers, lock, and dead keys", () => {
    for (const k of [
      "Meta",
      "Shift",
      "Alt",
      "Control",
      "CapsLock",
      "AltGraph",
      "Dead",
    ]) {
      expect(keepsSelection(k)).toBe(true);
    }
  });
  it("ends the selection for printing keys, arrows, Enter, and Backspace", () => {
    for (const k of ["a", "1", "@", "ArrowLeft", "Enter", "Backspace", "Tab"]) {
      expect(keepsSelection(k)).toBe(false);
    }
  });
});
