import { describe, expect, it, vi } from "vitest";
import { encodeText } from "./encodeText";

describe("encodeText", () => {
  it("encodes normal text to its true UTF-8 byte length", () => {
    for (const s of ["hello", "Página", "áéíóú".repeat(100), "a🙂b"]) {
      const out = encodeText(s);
      expect(out).toBeInstanceOf(Uint8Array);
      expect((out as Uint8Array).byteLength).toBe(Buffer.byteLength(s, "utf8"));
    }
  });

  it("binds an empty string as a string, never as bytes", () => {
    // A zero-length Uint8Array binds as NULL, and CAST(NULL AS TEXT) is NULL,
    // which every NOT NULL column here rejects.
    expect(encodeText("")).toBe("");
  });

  it("catches an encoder that under-counts, and recovers the full bytes", () => {
    // THE OBSERVED CORRUPTION. Four Atlas rows were stored at exactly
    // (original character count - 1) bytes: a UTF-16 length used as a byte
    // capacity, minus one for a NUL. That is the (length + 1) <= capacity()
    // shape store.ts already documents as aborting this machine twice. With
    // the assert compiled out it truncates silently instead.
    const s = "Página de aparatos auditivos";
    const short = {
      encode: (x: string) => new TextEncoder().encode(x).slice(0, x.length - 1),
    };
    const out = encodeText(s, short) as Uint8Array;
    expect(out.byteLength).toBe(Buffer.byteLength(s, "utf8"));
    expect(Buffer.from(out).toString("utf8")).toBe(s);
  });

  it("reports the misprediction rather than hiding the recovery", () => {
    const onMispredict = vi.fn();
    const s = "áéí";
    const short = {
      encode: (x: string) => new TextEncoder().encode(x).slice(0, 1),
    };
    encodeText(s, short, onMispredict);
    expect(onMispredict).toHaveBeenCalledWith(1, Buffer.byteLength(s, "utf8"));
  });

  it("does not call the reporter when the encoder is correct", () => {
    const onMispredict = vi.fn();
    encodeText("Página", undefined, onMispredict);
    expect(onMispredict).not.toHaveBeenCalled();
  });
});
