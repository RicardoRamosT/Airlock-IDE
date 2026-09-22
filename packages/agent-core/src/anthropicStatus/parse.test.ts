import { describe, expect, it } from "vitest";
import { parseAnthropicStatus } from "./parse";

describe("parseAnthropicStatus", () => {
  it("maps each Statuspage indicator to a friendly one", () => {
    const f = (ind: string) =>
      parseAnthropicStatus({ status: { indicator: ind, description: "x" } })
        .indicator;
    expect(f("none")).toBe("operational");
    expect(f("minor")).toBe("degraded");
    expect(f("major")).toBe("outage");
    expect(f("critical")).toBe("outage");
    expect(f("maintenance")).toBe("maintenance");
  });

  it("passes the description through", () => {
    expect(
      parseAnthropicStatus({
        status: { indicator: "none", description: "All Systems Operational" },
      }).description,
    ).toBe("All Systems Operational");
  });

  it("returns unknown for an unrecognized indicator", () => {
    expect(
      parseAnthropicStatus({ status: { indicator: "weird", description: "" } })
        .indicator,
    ).toBe("unknown");
  });

  it("returns unknown for missing/malformed payloads", () => {
    expect(parseAnthropicStatus(null).indicator).toBe("unknown");
    expect(parseAnthropicStatus({}).indicator).toBe("unknown");
    expect(parseAnthropicStatus({ status: 5 }).indicator).toBe("unknown");
    expect(parseAnthropicStatus(null).description).toBe("");
  });
});

// The real payload on 2026-09-14: five components fine, one degraded, and a
// global rollup of "minor" driven entirely by the one nobody here uses.
const LIVE = {
  status: { indicator: "minor", description: "Partially Degraded Service" },
  components: [
    { name: "claude.ai", status: "operational" },
    { name: "Claude Console (platform.claude.com)", status: "operational" },
    { name: "Claude API (api.anthropic.com)", status: "operational" },
    { name: "Claude Code", status: "operational" },
    { name: "Claude Cowork", status: "degraded_performance" },
    { name: "Claude for Government", status: "operational" },
  ],
};

describe("parseAnthropicStatus over components", () => {
  it("ignores an incident in a product AirLock does not use", () => {
    // THE BUG. The pill read "Claude Degraded" for days because Cowork was
    // degraded on Windows -- a product and a platform this user is not on.
    const s = parseAnthropicStatus(LIVE);
    expect(s.indicator).toBe("operational");
  });

  it("reports degraded when Claude Code itself is", () => {
    const s = parseAnthropicStatus({
      ...LIVE,
      components: LIVE.components.map((c) =>
        c.name === "Claude Code" ? { ...c, status: "degraded_performance" } : c,
      ),
    });
    expect(s.indicator).toBe("degraded");
    // and it SAYS which component, which is the whole point
    expect(s.component).toBe("Claude Code");
  });

  it("reports degraded when the API it talks to is", () => {
    const s = parseAnthropicStatus({
      ...LIVE,
      components: LIVE.components.map((c) =>
        c.name.startsWith("Claude API") ? { ...c, status: "major_outage" } : c,
      ),
    });
    expect(s.indicator).toBe("outage");
    // toBe, not toContain: Statuspage labels this component
    // "Claude API (api.anthropic.com)", and the loose assertion happily passed
    // while the pill showed a hostname to the user.
    expect(s.component).toBe("Claude API");
  });

  it("names the component WITHOUT the hostname Statuspage appends", () => {
    // The pill is chrome in a 22px bar, and a domain in it reads as a link to
    // somewhere. The canonical name is the one AirLock already watches by.
    const s = parseAnthropicStatus({
      ...LIVE,
      components: LIVE.components.map((c) =>
        c.name.startsWith("Claude API")
          ? { ...c, status: "degraded_performance" }
          : c,
      ),
    });
    expect(s.component).toBe("Claude API");
    expect(s.description).not.toContain("api.anthropic.com");
    expect(s.description).toBe("Claude API: degraded performance");
  });

  it("takes the WORST of the components it watches", () => {
    const s = parseAnthropicStatus({
      ...LIVE,
      components: LIVE.components.map((c) =>
        c.name === "Claude Code"
          ? { ...c, status: "degraded_performance" }
          : c.name.startsWith("Claude API")
            ? { ...c, status: "major_outage" }
            : c,
      ),
    });
    expect(s.indicator).toBe("outage");
  });

  it("keeps a partial outage short of a full one", () => {
    // "outage" must keep meaning "it is down", or it stops being actionable.
    const s = parseAnthropicStatus({
      ...LIVE,
      components: LIVE.components.map((c) =>
        c.name === "Claude Code" ? { ...c, status: "partial_outage" } : c,
      ),
    });
    expect(s.indicator).toBe("degraded");
  });

  it("falls back to the global rollup when components are missing", () => {
    // A Statuspage rename must not blank the indicator.
    expect(parseAnthropicStatus({ status: LIVE.status }).indicator).toBe(
      "degraded",
    );
    expect(
      parseAnthropicStatus({
        ...LIVE,
        components: [{ name: "Other", status: "operational" }],
      }).indicator,
    ).toBe("degraded");
  });

  it("names no component when it is judging the global rollup", () => {
    expect(parseAnthropicStatus({ status: LIVE.status }).component).toBeNull();
  });
});
