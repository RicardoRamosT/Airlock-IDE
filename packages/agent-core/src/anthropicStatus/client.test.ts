import { describe, expect, it, vi } from "vitest";
import { fetchAnthropicStatus } from "./client";

describe("fetchAnthropicStatus", () => {
  it("requests the official summary URL and returns the parsed status", async () => {
    const get = vi.fn(async () => ({
      status: { indicator: "minor", description: "Degraded" },
    }));
    const result = await fetchAnthropicStatus({ transport: { get } });
    expect(get).toHaveBeenCalledWith(
      "https://status.claude.com/api/v2/summary.json",
    );
    expect(result).toEqual({
      indicator: "degraded",
      description: "Degraded",
      // No components in this payload, so the rollup decided it and there is
      // no component to name.
      component: null,
    });
  });
});
