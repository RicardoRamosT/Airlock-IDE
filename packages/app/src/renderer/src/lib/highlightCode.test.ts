import { describe, expect, it } from "vitest";
import { highlightSpans } from "./highlightCode";

const text = (spans: { text: string }[]) => spans.map((s) => s.text).join("");

describe("highlightSpans", () => {
  it("tokenises a fence in a language the editor ships", () => {
    const spans = highlightSpans('const x: number = "a";', "ts");
    expect(spans).not.toBeNull();
    const kw = spans?.find((s) => s.text === "const");
    expect(kw?.cls).toMatch(/tok-keyword/);
    const str = spans?.find((s) => s.text === '"a"');
    expect(str?.cls).toMatch(/tok-string/);
  });

  it("round-trips the source exactly, newlines included", () => {
    const src = '{\n  "a": [1, 2],\n  "b": null\n}\n';
    expect(text(highlightSpans(src, "json") ?? [])).toBe(src);
  });

  it("accepts the common aliases for a language", () => {
    for (const lang of ["js", "javascript", "jsx", "typescript", "tsx", "TS"])
      expect(highlightSpans("let a = 1", lang)).not.toBeNull();
  });

  it("colours a YAML key differently from its value", () => {
    const spans = highlightSpans(
      "services:\n  db:\n    image: postgres:16\n",
      "yaml",
    );
    const key = spans?.find((s) => s.text === "image");
    const value = spans?.find((s) => s.text.includes("postgres"));
    expect(key?.cls).toBeTruthy();
    expect(key?.cls).not.toBe(value?.cls ?? "");
    expect(highlightSpans("a: 1", "yml")).not.toBeNull();
  });

  it("returns null for a language it has no grammar for, so the fence renders plain", () => {
    expect(highlightSpans("echo hi", "bash")).toBeNull();
    expect(highlightSpans("echo hi", null)).toBeNull();
  });
});
