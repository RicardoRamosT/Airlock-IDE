import { describe, expect, it } from "vitest";
import type { ExtensionSummary } from "../../../shared/ipc";
import {
  isRelevantHere,
  keepRelevant,
  relevantIds,
} from "./extensionRelevance";

const row = (
  id: string,
  projectUse?: ExtensionSummary["projectUse"],
): ExtensionSummary =>
  ({ id, name: id, projectUse }) as unknown as ExtensionSummary;

describe("isRelevantHere", () => {
  it("shows an extension the project signals for", () => {
    expect(isRelevantHere(row("docker", "signal"))).toBe(true);
  });

  it("shows one the user turned on here", () => {
    expect(isRelevantHere(row("azure", "optedIn"))).toBe(true);
  });

  it("hides one with neither", () => {
    expect(isRelevantHere(row("snowflake", "none"))).toBe(false);
  });

  // The case that decides whether this is safe to ship. An undefined answer
  // means "no answer", not "no". It happens before the first summary arrives
  // and for any extension that declares no relevance spec -- hiding on it
  // would blank the sidebar during startup.
  it("shows one whose relevance has no answer", () => {
    expect(isRelevantHere(row("files"))).toBe(true);
  });
});

describe("keepRelevant", () => {
  const rows = [{ id: "docker" }, { id: "snowflake" }];

  it("keeps only what the set names", () => {
    expect(keepRelevant(rows, ["docker"])).toEqual([{ id: "docker" }]);
  });

  // The startup case, and the reason this takes null rather than [].
  it("keeps everything when the set has not arrived", () => {
    expect(keepRelevant(rows, null)).toEqual(rows);
  });

  it("keeps nothing when the project genuinely uses none of them", () => {
    expect(keepRelevant(rows, [])).toEqual([]);
  });
});

describe("relevantIds", () => {
  it("keeps order and drops only the irrelevant", () => {
    expect(
      relevantIds([
        row("docker", "signal"),
        row("snowflake", "none"),
        row("slack", "optedIn"),
        row("github"),
      ]),
    ).toEqual(["docker", "slack", "github"]);
  });
});
