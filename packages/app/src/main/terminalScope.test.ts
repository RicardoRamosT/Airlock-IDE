import { describe, expect, it } from "vitest";
import { resolveTailScope } from "./terminalScope";

const A = "/p/airlock";
const B = "/p/trackview";

describe("resolveTailScope", () => {
  it("lets a project session read its OWN terminal", () => {
    expect(resolveTailScope(A, A)).toEqual({ ok: true, scope: A });
  });

  it("refuses another project's terminal, which is the isolation boundary", () => {
    expect(resolveTailScope(A, B)).toEqual({
      ok: false,
      error: "No such terminal",
    });
  });

  it("lets ATLAS read, since it has no project of its own", () => {
    // Atlas carries no per-project token, so its root is null. This used to
    // answer "No workspace open" for every terminal, leaving it able to type
    // into a terminal but never read it back.
    expect(resolveTailScope(null, A)).toEqual({ ok: true, scope: A });
    expect(resolveTailScope(null, B)).toEqual({ ok: true, scope: B });
  });

  it("names the OWNING project, never the caller's", () => {
    // The scope decides which vault redacts the output and which audit log
    // records the read, so it must follow the terminal, not the reader.
    const r = resolveTailScope(null, B);
    expect(r).toEqual({ ok: true, scope: B });
  });

  it("refuses an unknown terminal", () => {
    expect(resolveTailScope(A, null)).toEqual({
      ok: false,
      error: "No such terminal",
    });
    expect(resolveTailScope(null, null)).toEqual({
      ok: false,
      error: "No such terminal",
    });
  });

  it("answers an unknown terminal and a forbidden one IDENTICALLY", () => {
    // Distinguishing them would let a caller probe for the existence of
    // terminals in projects it is not allowed to read.
    expect(resolveTailScope(A, null)).toEqual(resolveTailScope(A, B));
  });
});
