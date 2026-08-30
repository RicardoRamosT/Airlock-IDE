import { expect, it } from "vitest";
import * as core from "../index";

it("exposes the Atlas engine through the index barrel", () => {
  // CLAUDE.md rule S4: the app imports this surface, never agent-core internals.
  for (const name of [
    "projectName",
    "mergeRegistry",
    "applyPresence",
    "seedRoots",
    "parseCommitLog",
    "collectRoot",
    "collectAll",
  ]) {
    expect(typeof (core as Record<string, unknown>)[name]).toBe("function");
  }
  expect(core.COMMIT_LOG_FORMAT).toContain("%H");
});
