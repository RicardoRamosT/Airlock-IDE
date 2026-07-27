import type { SlackHistory } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import type { AllowedChannel } from "./slack";
import { slackDownloadFileTool } from "./slackFiles";

const allowed: AllowedChannel[] = [{ id: "C1", name: "bugs", kind: "public" }];

const FILE = {
  id: "F1",
  name: "shot.png",
  mimetype: "image/png",
  size: 3,
  kind: "image" as const,
};
const withFile: SlackHistory = {
  ok: true,
  messages: [{ ts: "1.0", user: "U1", text: "", files: [FILE] }],
};

function deps(over: Record<string, unknown> = {}) {
  return {
    allowed: async () => allowed,
    token: async () => "xoxp-test",
    history: async () => withFile,
    fetchBytes: async () => ({ bytes: Buffer.from("png"), name: "shot.png" }),
    writeCache: async (
      _root: string,
      channelId: string,
      fileId: string,
      name: string,
    ) => `.slack-cache/${channelId}/${fileId}/${name}`,
    cached: async () => null,
    recent: () => null,
    ...over,
  };
}

describe("slackDownloadFileTool", () => {
  it("returns the cached relPath for a file in an allow-listed channel", async () => {
    const r = await slackDownloadFileTool("/repo", "bugs", "F1", deps());
    expect(r).toEqual({ relPath: ".slack-cache/C1/F1/shot.png" });
  });

  // The click was doing three sequential Slack round trips EVERY time, ~2-3s.
  // An already-downloaded file must cost nothing.
  it("serves an already-cached file without touching the network", async () => {
    let touched = false;
    const spy = async () => {
      touched = true;
      return withFile;
    };
    const r = await slackDownloadFileTool(
      "/repo",
      "bugs",
      "F1",
      deps({
        cached: async () => ".slack-cache/C1/F1/shot.png",
        token: async () => {
          touched = true;
          return "xoxp-test";
        },
        history: spy,
        fetchBytes: async () => {
          touched = true;
          return { bytes: Buffer.from(""), name: "x" };
        },
      }),
    );
    expect(r).toEqual({ relPath: ".slack-cache/C1/F1/shot.png" });
    expect(touched).toBe(false);
  });

  // The cache is a speed-up, NOT a bypass: live policy still decides.
  it("REFUSES a cached file whose channel left the allow-list", async () => {
    const r = await slackDownloadFileTool(
      "/repo",
      "secret",
      "F1",
      deps({ cached: async () => ".slack-cache/C9/F1/shot.png" }),
    );
    expect(r.error).toContain("not allowed");
    expect(r.relPath).toBeUndefined();
  });

  // The sidebar just fetched this channel's history to render the chip.
  it("proves membership against a fresh history instead of re-fetching", async () => {
    let fetched = false;
    const r = await slackDownloadFileTool(
      "/repo",
      "bugs",
      "F1",
      deps({
        recent: () => withFile,
        history: async () => {
          fetched = true;
          return withFile;
        },
      }),
    );
    expect(r.relPath).toBe(".slack-cache/C1/F1/shot.png");
    expect(fetched).toBe(false);
  });

  it("REFUSES a channel outside the allow-list without fetching anything", async () => {
    let fetched = false;
    const r = await slackDownloadFileTool(
      "/repo",
      "secret",
      "F1",
      deps({
        fetchBytes: async () => {
          fetched = true;
          return { bytes: Buffer.from(""), name: "x" };
        },
      }),
    );
    expect(r.error).toContain("not allowed");
    expect(fetched).toBe(false);
  });

  it("REFUSES a file id absent from that channel's history -- the gate's whole point", async () => {
    let fetched = false;
    const r = await slackDownloadFileTool(
      "/repo",
      "bugs",
      "F-OTHER",
      deps({
        fetchBytes: async () => {
          fetched = true;
          return { bytes: Buffer.from(""), name: "x" };
        },
      }),
    );
    expect(r.error).toContain("not in");
    expect(fetched).toBe(false);
  });

  it("reports not-connected when there is no vaulted token", async () => {
    const r = await slackDownloadFileTool(
      "/repo",
      "bugs",
      "F1",
      deps({ token: async () => null }),
    );
    expect(r.error).toContain("not connected");
  });

  it("surfaces a missing_scope refusal as a RECONNECT instruction", async () => {
    const r = await slackDownloadFileTool(
      "/repo",
      "bugs",
      "F1",
      deps({ fetchBytes: async () => ({ error: "missing_scope" }) }),
    );
    expect(r.error).toMatch(/reconnect/i);
  });

  it("surfaces a history refusal instead of pretending the file is missing", async () => {
    const r = await slackDownloadFileTool(
      "/repo",
      "bugs",
      "F1",
      deps({
        history: async () => ({ ok: false as const, error: "not_in_channel" }),
      }),
    );
    expect(r.error).toContain("not_in_channel");
  });

  it("refuses with no project focused", async () => {
    const r = await slackDownloadFileTool(null, "bugs", "F1", deps());
    expect(r.error).toContain("No project");
  });
});
