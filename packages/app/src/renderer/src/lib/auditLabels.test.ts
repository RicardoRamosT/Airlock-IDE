import { describe, expect, it } from "vitest";
import { auditLabel, auditSummary } from "./auditLabels";

describe("auditLabel", () => {
  it("maps known ops to a label + icon", () => {
    expect(auditLabel("git.push")).toEqual({
      label: "Pushed",
      icon: "repo-push",
    });
    expect(auditLabel("secret.set").label).toBe("Vaulted a secret");
  });
  it("falls back to the raw op for unknown ops", () => {
    expect(auditLabel("mystery.thing")).toEqual({
      label: "mystery.thing",
      icon: "circle-small-filled",
    });
  });
});

describe("auditSummary", () => {
  it("prefers a from -> to move", () => {
    expect(auditSummary({ from: "a.ts", to: "b.ts" })).toBe("a.ts → b.ts");
  });
  it("uses name / label / path / service", () => {
    expect(auditSummary({ name: "DATABASE_URL" })).toBe("DATABASE_URL");
    expect(auditSummary({ label: "me@x.com" })).toBe("me@x.com");
    expect(auditSummary({ path: "src/app.ts" })).toBe("src/app.ts");
    expect(auditSummary({ service: "srv-1" })).toBe("srv-1");
  });
  it("pluralizes a file count and shortens a sha", () => {
    expect(auditSummary({ count: 1 })).toBe("1 file");
    expect(auditSummary({ count: 3 })).toBe("3 files");
    expect(auditSummary({ sha: "abcdef1234567" })).toBe("abcdef1");
  });
  it("returns '' when nothing notable", () => {
    expect(auditSummary({})).toBe("");
  });
});
