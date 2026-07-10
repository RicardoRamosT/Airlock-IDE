import { describe, expect, it } from "vitest";
import { slackWorkspacePatch } from "./slackWorkspace";

describe("slackWorkspacePatch", () => {
  it("records the connected workspace id + name", () => {
    expect(
      slackWorkspacePatch(undefined, { teamId: "T1", team: "Acme" }),
    ).toEqual({ workspace: { id: "T1", name: "Acme" } });
  });

  it("keeps channels when the workspace is unchanged", () => {
    const cur = {
      workspace: { id: "T1", name: "Acme" },
      channels: [{ id: "C1", name: "gen" }],
    };
    expect(slackWorkspacePatch(cur, { teamId: "T1", team: "Acme" })).toEqual({
      workspace: { id: "T1", name: "Acme" },
    });
  });

  it("resets channels when the workspace changes", () => {
    const cur = {
      workspace: { id: "T1", name: "Acme" },
      channels: [{ id: "C1", name: "gen" }],
    };
    expect(slackWorkspacePatch(cur, { teamId: "T2", team: "Beta" })).toEqual({
      workspace: { id: "T2", name: "Beta" },
      channels: [],
    });
  });

  it("does not reset on the first connect (no previous workspace)", () => {
    expect(slackWorkspacePatch({}, { teamId: "T2", team: "Beta" })).toEqual({
      workspace: { id: "T2", name: "Beta" },
    });
  });
});
