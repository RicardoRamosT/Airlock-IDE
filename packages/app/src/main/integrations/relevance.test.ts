// packages/app/src/main/integrations/relevance.test.ts
import { describe, expect, it, vi } from "vitest";
import { optedInExtensions, relevanceContextFor } from "./relevance";

describe("relevanceContextFor", () => {
  it("gathers vaulted secret NAMES and the root listing", async () => {
    const ctx = await relevanceContextFor(
      "/repo",
      async () => ["DATABASE_URL", "STRIPE_SECRET_KEY"],
      async () => ["package.json", "azure.yaml"],
      async () => ["snowflake"],
    );
    expect(ctx).toEqual({
      secretNames: ["DATABASE_URL", "STRIPE_SECRET_KEY"],
      rootFiles: ["package.json", "azure.yaml"],
      optedIn: ["snowflake"],
    });
  });

  it("passes the root through to both readers", async () => {
    const names = vi.fn(async () => []);
    const files = vi.fn(async () => []);
    const opted = vi.fn(async () => []);
    await relevanceContextFor("/repo", names, files, opted);
    expect(names).toHaveBeenCalledWith("/repo");
    expect(files).toHaveBeenCalledWith("/repo");
    expect(opted).toHaveBeenCalledWith("/repo");
  });

  // An unreadable root (deleted, or a permissions error) must not reject: the
  // callers use this to decide whether to SHOW a section, and a throw there
  // would turn a missing signal into a broken panel. Degrading to "no file
  // signal" is the pre-existing behaviour this was extracted from.
  it("degrades to no file signal when the root cannot be read", async () => {
    const ctx = await relevanceContextFor(
      "/gone",
      async () => ["AZURE_CLIENT_ID"],
      async () => {
        throw new Error("ENOENT");
      },
      async () => [],
    );
    expect(ctx).toEqual({
      secretNames: ["AZURE_CLIENT_ID"],
      rootFiles: [],
      optedIn: [],
    });
  });

  // Deliberately NOT caught, matching the code this replaced: a keychain read
  // that fails is not evidence the project is irrelevant, and swallowing it
  // would silently HIDE a section the user does use. Let it surface.
  it("propagates a secret-store failure rather than reading it as irrelevant", async () => {
    await expect(
      relevanceContextFor(
        "/repo",
        async () => {
          throw new Error("keychain locked");
        },
        async () => [],
        async () => [],
      ),
    ).rejects.toThrow("keychain locked");
  });
});

// The opt-in is a hand-editable JSON field, so only a real boolean counts.
describe("optedInExtensions", () => {
  it("lists the ids whose useHere is exactly true", () => {
    expect(
      optedInExtensions({
        azure: { useHere: true },
        snowflake: { useHere: false },
        slack: { channels: ["C1"] },
      }),
    ).toEqual(["azure"]);
  });

  it("ignores truthy-but-not-true values a hand-edited file may contain", () => {
    expect(
      optedInExtensions({
        a: { useHere: "true" },
        b: { useHere: 1 },
        c: { useHere: null },
      }),
    ).toEqual([]);
  });

  it("is empty for a project with no extensions map at all", () => {
    expect(optedInExtensions(undefined)).toEqual([]);
  });
});
