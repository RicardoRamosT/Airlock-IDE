import { describe, expect, it } from "vitest";
import type { AllowedChannel } from "./slack";
import { resolveAllowedChannel } from "./slackTools";

const allowed: AllowedChannel[] = [
  { id: "C1", name: "bugs" },
  { id: "C2", name: "eng" },
];

describe("resolveAllowedChannel (the permission gate)", () => {
  it("matches by id", () => {
    expect(resolveAllowedChannel(allowed, "C1")?.name).toBe("bugs");
  });
  it("matches by name and by #name", () => {
    expect(resolveAllowedChannel(allowed, "eng")?.id).toBe("C2");
    expect(resolveAllowedChannel(allowed, "#eng")?.id).toBe("C2");
    expect(resolveAllowedChannel(allowed, " eng ")?.id).toBe("C2");
  });
  it("REJECTS a channel that is not in the allow-list", () => {
    expect(resolveAllowedChannel(allowed, "secret")).toBeNull();
    expect(resolveAllowedChannel(allowed, "C999")).toBeNull();
    expect(resolveAllowedChannel([], "bugs")).toBeNull();
  });
});
