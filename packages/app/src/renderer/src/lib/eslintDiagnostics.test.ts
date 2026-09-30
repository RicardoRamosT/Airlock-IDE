import type { Diagnostic } from "@codemirror/lint";
import { describe, expect, it, vi } from "vitest";
import type { EslintLintMessage } from "../../../shared/ipc";
import { acceptResult, eslintToCm, mergeBySource } from "./eslintDiagnostics";

const msg = (o: Partial<EslintLintMessage>): EslintLintMessage => ({
  line: 1,
  column: 1,
  severity: 2,
  ruleId: "no-var",
  message: "Unexpected var, use let or const instead.",
  ...o,
});

describe("eslintToCm", () => {
  const text = "ab\ncd\n";

  it("maps ESLint's 1-based line/column to offsets, end exclusive", () => {
    const [d] = eslintToCm(
      text,
      [msg({ line: 2, column: 1, endLine: 2, endColumn: 3 })],
      vi.fn(),
    );
    expect([d?.from, d?.to]).toEqual([3, 5]);
  });

  it("gives a mark with no end one character, clamped to the doc", () => {
    const [a] = eslintToCm(text, [msg({ line: 1, column: 2 })], vi.fn());
    expect([a?.from, a?.to]).toEqual([1, 2]);
    const [b] = eslintToCm(text, [msg({ line: 9, column: 1 })], vi.fn());
    expect([b?.from, b?.to]).toEqual([text.length, text.length]);
  });

  it("uses the rule's severity: 2 is an error, 1 a warning", () => {
    const [e, w] = eslintToCm(
      text,
      [msg({ severity: 2 }), msg({ severity: 1 })],
      vi.fn(),
    );
    expect([e?.severity, w?.severity]).toEqual(["error", "warning"]);
  });

  it("names the rule so you can tell ESLint from TypeScript", () => {
    const [a, b] = eslintToCm(text, [msg({}), msg({ ruleId: null })], vi.fn());
    expect(a?.source).toBe("eslint(no-var)");
    expect(b?.source).toBe("eslint");
  });

  it("offers exactly one Fix action when ESLint has a fix, and none otherwise", () => {
    const onFix = vi.fn();
    const fix = { range: [0, 3] as [number, number], text: "let" };
    const [withFix, without] = eslintToCm(text, [msg({ fix }), msg({})], onFix);
    expect(withFix?.actions?.map((a) => a.name)).toEqual(["Fix"]);
    // biome-ignore lint/suspicious/noExplicitAny: the view is unused by our action
    withFix?.actions?.[0]?.apply(null as any, 0, 0);
    expect(onFix).toHaveBeenCalledWith(fix);
    expect(without?.actions).toBeUndefined();
  });
});

describe("mergeBySource", () => {
  const d = (m: string): Diagnostic => ({
    from: 0,
    to: 1,
    severity: "error",
    message: m,
  });

  it("shows both sources together", () => {
    expect(
      mergeBySource({ typescript: [d("ts")], eslint: [d("es")] }).map(
        (x) => x.message,
      ),
    ).toEqual(["ts", "es"]);
  });

  it("replacing one source never drops the other (setDiagnostics replaces ALL)", () => {
    const by = { typescript: [d("ts")], eslint: [d("es1")] };
    by.eslint = [d("es2")];
    expect(mergeBySource(by).map((x) => x.message)).toEqual(["ts", "es2"]);
    expect(mergeBySource({ eslint: [d("es")] }).map((x) => x.message)).toEqual([
      "es",
    ]);
  });
});

describe("acceptResult", () => {
  it("paints only a result for the current doc version", () => {
    expect(acceptResult(5, 5)).toBe(true);
    expect(acceptResult(5, 4)).toBe(false);
  });
});
