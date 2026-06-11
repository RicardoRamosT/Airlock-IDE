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
