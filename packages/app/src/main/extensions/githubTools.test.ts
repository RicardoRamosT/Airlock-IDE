import { describe, expect, it } from "vitest";
import { parseIssue } from "./githubTools";

describe("parseIssue", () => {
  it("maps only the fields we surface", () => {
    expect(
      parseIssue({
        title: "Bug",
        body: "boom",
        state: "open",
        html_url: "u",
        extra: 1,
      }),
    ).toEqual({ title: "Bug", body: "boom", state: "open", url: "u" });
  });
  it("tolerates a missing/garbage payload", () => {
    expect(parseIssue(null)).toEqual({
      title: "",
      body: "",
      state: "",
      url: "",
    });
  });
});
