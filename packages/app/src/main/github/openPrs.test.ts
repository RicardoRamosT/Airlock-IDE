import { describe, expect, it } from "vitest";
import { parseOpenPrs } from "./openPrs";

const raw = JSON.stringify([
  { number: 1, isDraft: false, reviewDecision: null, author: { login: "me" } },
  { number: 2, isDraft: true, reviewDecision: null, author: { login: "me" } },
  {
    number: 3,
    isDraft: false,
    reviewDecision: "APPROVED",
    author: { login: "me" },
  },
  {
    number: 4,
    isDraft: false,
    reviewDecision: null,
    author: { login: "other" },
  },
]);

describe("parseOpenPrs", () => {
  it("marks only your own non-draft unreviewed PR as awaiting you", () => {
    const got = parseOpenPrs(raw, "me");
    expect(got).toHaveLength(4);
    expect(got[0]).toEqual({ mine: true, awaitingReview: true, draft: false });
  });

  it("does not claim a draft or an already-decided PR", () => {
    const got = parseOpenPrs(raw, "me");
    expect(got[1]).toEqual({ mine: true, awaitingReview: true, draft: true });
    expect(got[2]?.awaitingReview).toBe(false);
  });

  it("does not claim a teammate's PR as yours", () => {
    expect(parseOpenPrs(raw, "me")[3]?.mine).toBe(false);
  });

  it("treats REVIEW_REQUIRED as still awaiting review", () => {
    const one = JSON.stringify([
      {
        number: 9,
        isDraft: false,
        reviewDecision: "REVIEW_REQUIRED",
        author: { login: "me" },
      },
    ]);
    expect(parseOpenPrs(one, "me")[0]?.awaitingReview).toBe(true);
  });

  it("treats CHANGES_REQUESTED as decided, not awaiting", () => {
    const one = JSON.stringify([
      {
        number: 9,
        isDraft: false,
        reviewDecision: "CHANGES_REQUESTED",
        author: { login: "me" },
      },
    ]);
    expect(parseOpenPrs(one, "me")[0]?.awaitingReview).toBe(false);
  });

  it("never claims a PR when the viewer's login is unknown", () => {
    // An empty login must not match an empty author login and turn every
    // anonymous row into "yours".
    const one = JSON.stringify([
      { number: 9, isDraft: false, reviewDecision: null, author: {} },
    ]);
    expect(parseOpenPrs(one, "")[0]?.mine).toBe(false);
  });

  it("returns [] for junk rather than throwing", () => {
    expect(parseOpenPrs("not json", "me")).toEqual([]);
    expect(parseOpenPrs("{}", "me")).toEqual([]);
    expect(parseOpenPrs("[null, 3]", "me")).toEqual([]);
  });
});
