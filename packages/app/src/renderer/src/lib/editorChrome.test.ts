import { describe, expect, it } from "vitest";
import { bracketDepthClass } from "./editorChrome";

describe("bracketDepthClass", () => {
  it("maps nesting depth to a class, cycling every 6 levels", () => {
    expect(bracketDepthClass(0)).toBe("cm-bracket-depth-0");
    expect(bracketDepthClass(5)).toBe("cm-bracket-depth-5");
    expect(bracketDepthClass(6)).toBe("cm-bracket-depth-0");
    expect(bracketDepthClass(13)).toBe("cm-bracket-depth-1");
  });
  it("treats negative depth (unbalanced) as 0", () => {
    expect(bracketDepthClass(-1)).toBe("cm-bracket-depth-0");
  });
});
