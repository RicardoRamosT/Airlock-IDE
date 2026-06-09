import { describe, expect, it, vi } from "vitest";

vi.mock("@airlock/agent-core", () => ({
  commitStaged: vi.fn(async () => "abc1234"),
  appendAudit: vi.fn(async () => undefined),
}));
vi.mock("./scan", () => ({ scanStaged: vi.fn() }));

import { appendAudit, commitStaged } from "@airlock/agent-core";
import { guardedCommit } from "./commit";
import { scanStaged } from "./scan";

const commitMock = commitStaged as unknown as ReturnType<typeof vi.fn>;
const auditMock = appendAudit as unknown as ReturnType<typeof vi.fn>;
const scanMock = scanStaged as unknown as ReturnType<typeof vi.fn>;
const leak = { path: "a.ts", line: 3, name: "API_KEY" };

describe("guardedCommit", () => {
  it("advisory: commits even with leaks, returns them", async () => {
    scanMock.mockResolvedValue([leak]);
    commitMock.mockClear();
    auditMock.mockClear();
    const out = await guardedCommit("/r", "msg", { gated: false });
    expect(commitMock).toHaveBeenCalledWith("/r", "msg");
    expect(out).toEqual({ committed: true, sha: "abc1234", leaks: [leak] });
    // audited as a human commit; leaks:1 flags the override-with-leaks case
    expect(auditMock).toHaveBeenCalledWith("/r", "user", "git.commit", {
      sha: "abc1234",
      leaks: 1,
    });
  });

  it("gated + leaks + no confirm: blocks, does not commit", async () => {
    scanMock.mockResolvedValue([leak]);
    commitMock.mockClear();
    auditMock.mockClear();
    const out = await guardedCommit("/r", "msg", { gated: true });
    expect(commitMock).not.toHaveBeenCalled();
    expect(out).toEqual({
      committed: false,
      sha: null,
      blocked: true,
      leaks: [leak],
    });
    // the held-back agent commit is audited as a blocked event
    expect(auditMock).toHaveBeenCalledWith(
      "/r",
      "agent",
      "git.commit.blocked",
      {
        leaks: 1,
      },
    );
  });

  it("gated + confirm: commits despite leaks", async () => {
    scanMock.mockResolvedValue([leak]);
    commitMock.mockClear();
    auditMock.mockClear();
    const out = await guardedCommit("/r", "msg", {
      gated: true,
      confirm: true,
    });
    expect(commitMock).toHaveBeenCalledWith("/r", "msg");
    expect(out).toEqual({ committed: true, sha: "abc1234", leaks: [leak] });
    expect(auditMock).toHaveBeenCalledWith("/r", "agent", "git.commit", {
      sha: "abc1234",
      leaks: 1,
    });
  });

  it("gated + clean: commits normally", async () => {
    scanMock.mockResolvedValue([]);
    commitMock.mockClear();
    auditMock.mockClear();
    const out = await guardedCommit("/r", "msg", { gated: true });
    expect(out).toEqual({ committed: true, sha: "abc1234", leaks: [] });
    expect(auditMock).toHaveBeenCalledWith("/r", "agent", "git.commit", {
      sha: "abc1234",
      leaks: 0,
    });
  });

  // PB-H11: the scan is ADVISORY for the human -- if it throws (locked keychain,
  // git error), the human's commit must still proceed (fail-open), not error out.
  it("human commit is fail-open when the scan throws (PB-H11)", async () => {
    scanMock.mockRejectedValue(new Error("keychain locked"));
    commitMock.mockClear();
    const out = await guardedCommit("/r", "msg", { gated: false });
    expect(commitMock).toHaveBeenCalledWith("/r", "msg");
    expect(out).toEqual({ committed: true, sha: "abc1234", leaks: [] });
  });

  // ...but the agent stays fail-CLOSED: a scan failure must not let a possible
  // leak through, so the gated commit propagates the error and does not commit.
  it("agent commit is fail-closed when the scan throws (PB-H11)", async () => {
    scanMock.mockRejectedValue(new Error("keychain locked"));
    commitMock.mockClear();
    await expect(guardedCommit("/r", "msg", { gated: true })).rejects.toThrow(
      /keychain/,
    );
    expect(commitMock).not.toHaveBeenCalled();
  });
});
