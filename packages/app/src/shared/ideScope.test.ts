import { describe, expect, it } from "vitest";
import { resolveCommandTab, type ScopeTab } from "./ideScope";

const TABS: ScopeTab[] = [
  { id: "proj-8", root: "/p/Muros-Estates" },
  { id: "proj-10", root: "/p/aparatosauditivos" },
  { id: "blank-1", root: null },
];
const FOCUSED = "proj-8"; // the user is working in Muros-Estates

describe("resolveCommandTab", () => {
  it("sends a background project's command to ITS OWN tab, not the focused one", () => {
    // THE BUG. aparatosauditivos' Claude called open_terminal while the user
    // was in Muros-Estates, and the terminal was created in Muros-Estates --
    // with Muros-Estates' vaulted secrets injected into it.
    const t = resolveCommandTab(
      "/p/aparatosauditivos",
      undefined,
      TABS,
      FOCUSED,
    );
    expect(t).toEqual({ ok: true, tabId: "proj-10", focus: false });
  });

  it("never steals focus from a project the user is working in", () => {
    const t = resolveCommandTab(
      "/p/aparatosauditivos",
      undefined,
      TABS,
      FOCUSED,
    );
    expect(t.ok && t.focus).toBe(false);
  });

  it("focuses when the caller's own tab is already the focused one", () => {
    // Nothing to steal: the user is already looking at it.
    const t = resolveCommandTab("/p/Muros-Estates", undefined, TABS, FOCUSED);
    expect(t).toEqual({ ok: true, tabId: "proj-8", focus: true });
  });

  it("refuses an explicit tab belonging to another project", () => {
    const t = resolveCommandTab(
      "/p/aparatosauditivos",
      "proj-8",
      TABS,
      FOCUSED,
    );
    expect(t).toEqual({ ok: false, error: "No such tab" });
  });

  it("answers an unknown tab and a forbidden tab identically", () => {
    // Same rule resolveTailScope follows: distinguishing them would let a
    // caller probe for tabs in projects it cannot touch.
    const unknown = resolveCommandTab(
      "/p/aparatosauditivos",
      "nope",
      TABS,
      FOCUSED,
    );
    const forbidden = resolveCommandTab(
      "/p/aparatosauditivos",
      "proj-8",
      TABS,
      FOCUSED,
    );
    expect(unknown).toEqual(forbidden);
  });

  it("tells a caller with no tab open to ask the user", () => {
    const t = resolveCommandTab("/p/Trackview", undefined, TABS, FOCUSED);
    expect(t.ok).toBe(false);
  });

  it("leaves Atlas portfolio-wide, exactly as before", () => {
    // Atlas carries no token, so its root is null. It has no single project by
    // construction -- the same carve-out resolveTailScope makes.
    expect(resolveCommandTab(null, undefined, TABS, FOCUSED)).toEqual({
      ok: true,
      tabId: "proj-8",
      focus: true,
    });
    expect(resolveCommandTab(null, "proj-10", TABS, FOCUSED)).toEqual({
      ok: true,
      tabId: "proj-10",
      focus: true,
    });
  });
});
