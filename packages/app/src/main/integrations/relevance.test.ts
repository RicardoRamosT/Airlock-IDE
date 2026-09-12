// packages/app/src/main/integrations/relevance.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  boundExtensions,
  optedInExtensions,
  type RelevanceReaders,
  relevanceContextFor,
} from "./relevance";

// Every reader defaults to "nothing here"; a test overrides only the one it
// is about, so adding a sixth signal later does not rewrite every case.
const readers = (over: Partial<RelevanceReaders> = {}): RelevanceReaders => ({
  secretNames: async () => [],
  rootFiles: async () => [],
  optedIn: async () => [],
  gitRemoteHost: async () => null,
  connectedHere: async () => [],
  tech: async () => [],
  ...over,
});

describe("relevanceContextFor", () => {
  it("gathers vaulted secret NAMES and the root listing", async () => {
    const ctx = await relevanceContextFor(
      "/repo",
      readers({
        secretNames: async () => ["DATABASE_URL", "STRIPE_SECRET_KEY"],
        rootFiles: async () => ["package.json", "azure.yaml"],
        optedIn: async () => ["snowflake"],
        gitRemoteHost: async () => "github.com",
        connectedHere: async () => ["slack"],
        tech: async () => ["docker", "neon"],
      }),
    );
    expect(ctx).toEqual({
      secretNames: ["DATABASE_URL", "STRIPE_SECRET_KEY"],
      rootFiles: ["package.json", "azure.yaml"],
      gitRemoteHost: "github.com",
      tech: ["docker", "neon"],
      connectedHere: ["slack"],
      optedIn: ["snowflake"],
    });
  });

  it("passes the root through to every reader", async () => {
    const spies = {
      secretNames: vi.fn(async () => []),
      rootFiles: vi.fn(async () => []),
      optedIn: vi.fn(async () => []),
      gitRemoteHost: vi.fn(async () => null),
      connectedHere: vi.fn(async () => []),
      tech: vi.fn(async () => []),
    };
    await relevanceContextFor("/repo", spies);
    for (const fn of Object.values(spies))
      expect(fn).toHaveBeenCalledWith("/repo");
  });

  // A project need not be a git repo, and a git failure is not evidence the
  // project is irrelevant -- it just means that ONE signal is unavailable.
  it("degrades to no git signal when there is no remote", async () => {
    const ctx = await relevanceContextFor(
      "/repo",
      readers({
        gitRemoteHost: async () => {
          throw new Error("not a git repository");
        },
      }),
    );
    expect(ctx.gitRemoteHost).toBeNull();
  });

  // An unreadable root (deleted, or a permissions error) must not reject: the
  // callers use this to decide whether to SHOW a section, and a throw there
  // would turn a missing signal into a broken panel. Degrading to "no file
  // signal" is the pre-existing behaviour this was extracted from.
  it("degrades to no file signal when the root cannot be read", async () => {
    const ctx = await relevanceContextFor(
      "/gone",
      readers({
        secretNames: async () => ["AZURE_CLIENT_ID"],
        rootFiles: async () => {
          throw new Error("ENOENT");
        },
      }),
    );
    expect(ctx).toEqual({
      secretNames: ["AZURE_CLIENT_ID"],
      rootFiles: [],
      gitRemoteHost: null,
      tech: [],
      connectedHere: [],
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
        readers({
          secretNames: async () => {
            throw new Error("keychain locked");
          },
        }),
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

// Being bound here is the only signal an identity can ever have: nothing in a
// repo says "this project uses Slack".
describe("boundExtensions", () => {
  it("lists an extension with a verified workspace binding", () => {
    expect(
      boundExtensions({
        slack: { workspace: { id: "T123", name: "Airlock" } },
        azure: { useHere: true },
      }),
    ).toEqual(["slack"]);
  });

  it("ignores a pin with no verified id behind it", () => {
    // workspacePin is what the user REQUESTED; only the verified id counts.
    expect(
      boundExtensions({ slack: { workspacePin: "airlock", workspace: {} } }),
    ).toEqual([]);
  });

  it("accepts a plain connected flag", () => {
    expect(boundExtensions({ github: { connected: true } })).toEqual([
      "github",
    ]);
  });

  it("is empty for a project with no extensions map at all", () => {
    expect(boundExtensions(undefined)).toEqual([]);
  });
});
