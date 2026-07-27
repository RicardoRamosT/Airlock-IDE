import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { slackWorkspace } from "./slack";

// Writes a project config the way the app stores it: .airlock/config.json.
function project(slack: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "slack-ws-"));
  mkdirSync(join(root, ".airlock"), { recursive: true });
  writeFileSync(
    join(root, ".airlock", "config.json"),
    JSON.stringify({ extensions: { slack } }),
  );
  return root;
}

describe("slackWorkspace", () => {
  it("reads the recorded workspace", async () => {
    const root = project({ workspace: { id: "T1", name: "Acme" } });
    expect(await slackWorkspace(root)).toEqual({ id: "T1", name: "Acme" });
  });

  // Connected before the workspace was recorded. Returning null is what makes
  // the sidebar say "unknown" instead of inventing a name -- the exact failure
  // this feature exists to prevent.
  it("returns null when no workspace was recorded", async () => {
    expect(await slackWorkspace(project({ channels: [] }))).toBeNull();
    expect(await slackWorkspace(project({}))).toBeNull();
  });

  it("returns null for a malformed workspace rather than a partial one", async () => {
    expect(
      await slackWorkspace(project({ workspace: { id: "T1" } })),
    ).toBeNull();
    expect(await slackWorkspace(project({ workspace: "Acme" }))).toBeNull();
  });
});
