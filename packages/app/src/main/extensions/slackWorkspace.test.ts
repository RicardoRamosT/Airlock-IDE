import { describe, expect, it } from "vitest";
import { slackBindPatch, slackWorkspacePatch } from "./slackWorkspace";

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

// The BIND path (the hub's "Use <workspace>" one-click reuse) needs the same
// workspace-change reset the connect path above has always had, and did not
// have it: bindSlackWorkspace spread the old slack config straight through, so
// a project re-bound to a different workspace kept the previous workspace's
// channel ids. Diagnosed 2026-07-27 from a real config -- a project reading
// "Not connected." still carried three channels from an earlier connect, which
// is what the Slack section then listed.
describe("slackBindPatch", () => {
  it("records the workspace ref, name and domain included", () => {
    expect(
      slackBindPatch({}, { id: "T1", name: "Acme", domain: "acme" }),
    ).toEqual({ workspace: { id: "T1", name: "Acme", domain: "acme" } });
  });

  it("resets channels when binding to a DIFFERENT workspace", () => {
    const cur = {
      workspace: { id: "T1", name: "Acme" },
      channels: [{ id: "C1", name: "gen" }],
    };
    expect(
      slackBindPatch(cur, { id: "T2", name: "Beta", domain: "beta" }),
    ).toEqual({
      workspace: { id: "T2", name: "Beta", domain: "beta" },
      channels: [],
    });
  });

  // Re-binding the SAME workspace is not a change of meaning: the ids still
  // resolve, so throwing the user's allow-list away would be gratuitous.
  it("keeps channels when re-binding the same workspace", () => {
    const cur = {
      workspace: { id: "T1", name: "Acme" },
      channels: [{ id: "C1", name: "gen" }],
    };
    expect(
      slackBindPatch(cur, { id: "T1", name: "Acme", domain: "acme" }),
    ).toEqual({ workspace: { id: "T1", name: "Acme", domain: "acme" } });
  });

  // A first bind has no previous workspace, so there is nothing to invalidate
  // -- but a stale allow-list from a project that was connected and then
  // disconnected has no workspace either, and IS meaningless. Cleared, because
  // an allow-list with no workspace cannot be shown to belong to this one.
  it("resets an orphaned allow-list left behind with no workspace", () => {
    expect(
      slackBindPatch(
        { channels: [{ id: "C1", name: "gen" }] },
        { id: "T1", name: "Acme", domain: "acme" },
      ),
    ).toEqual({
      workspace: { id: "T1", name: "Acme", domain: "acme" },
      channels: [],
    });
  });

  it("leaves a clean first bind alone", () => {
    expect(
      slackBindPatch({}, { id: "T1", name: "Acme", domain: "acme" }),
    ).toEqual({ workspace: { id: "T1", name: "Acme", domain: "acme" } });
  });

  // Unbinding drops the workspace; the allow-list goes with it, since it can no
  // longer be attributed to anything.
  it("drops both the workspace and the allow-list on unbind", () => {
    const cur = {
      workspace: { id: "T1", name: "Acme" },
      channels: [{ id: "C1", name: "gen" }],
    };
    expect(slackBindPatch(cur, null)).toEqual({
      workspace: undefined,
      channels: [],
    });
  });
});
