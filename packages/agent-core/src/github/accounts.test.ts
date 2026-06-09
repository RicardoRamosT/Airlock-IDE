import { describe, expect, it } from "vitest";
import {
  ghToken,
  ghUserIdentity,
  parseGhAuthStatus,
  parseGhUser,
  switchGhAccount,
} from "./accounts";

const REAL = `github.com
  ✓ Logged in to github.com account RicardoRamosT (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'

  ✓ Logged in to github.com account vnricardotrevino (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'
`;

describe("parseGhAuthStatus", () => {
  it("parses multiple accounts with the active marker", () => {
    expect(parseGhAuthStatus(REAL)).toEqual([
      { host: "github.com", username: "RicardoRamosT", active: true },
      { host: "github.com", username: "vnricardotrevino", active: false },
    ]);
  });

  it("returns [] for empty / not-logged-in output", () => {
    expect(parseGhAuthStatus("")).toEqual([]);
    expect(
      parseGhAuthStatus("You are not logged into any GitHub hosts."),
    ).toEqual([]);
  });

  it("handles a single account", () => {
    const one =
      "github.com\n  Logged in to github.com account solo (oauth_token)\n  - Active account: true\n";
    expect(parseGhAuthStatus(one)).toEqual([
      { host: "github.com", username: "solo", active: true },
    ]);
  });

  it("handles an enterprise host alongside github.com", () => {
    const multi = `github.com
  Logged in to github.com account alice (keyring)
  - Active account: true
ghe.corp.com
  Logged in to ghe.corp.com account alice-corp (keyring)
  - Active account: true
`;
    expect(parseGhAuthStatus(multi)).toEqual([
      { host: "github.com", username: "alice", active: true },
      { host: "ghe.corp.com", username: "alice-corp", active: true },
    ]);
  });
});

describe("switchGhAccount", () => {
  it("rejects injected host/username and runs the right argv otherwise", async () => {
    await expect(
      switchGhAccount("github.com", "bad;rm", async () => ""),
    ).rejects.toThrow(/invalid/i);
    let captured: string[] = [];
    await switchGhAccount("github.com", "alice", async (args) => {
      captured = args;
      return "";
    });
    expect(captured).toEqual([
      "auth",
      "switch",
      "--hostname",
      "github.com",
      "--user",
      "alice",
    ]);
  });
});

it("ghToken requests the token for a specific account", async () => {
  let seen: string[] = [];
  const run = async (args: string[]) => {
    seen = args;
    return "gho_TESTTOKEN\n";
  };
  const tok = await ghToken("github.com", "RicardoRamosT", run);
  expect(tok).toBe("gho_TESTTOKEN");
  expect(seen).toEqual([
    "auth",
    "token",
    "--hostname",
    "github.com",
    "--user",
    "RicardoRamosT",
  ]);
});

it("parseGhUser uses name+email, falling back to login and noreply", () => {
  expect(
    parseGhUser('{"login":"rrt","id":42,"name":"Ricardo","email":"r@x.com"}'),
  ).toEqual({ name: "Ricardo", email: "r@x.com" });
  expect(
    parseGhUser('{"login":"rrt","id":42,"name":null,"email":null}'),
  ).toEqual({ name: "rrt", email: "42+rrt@users.noreply.github.com" });
});

it("ghUserIdentity passes the token via env, not argv", async () => {
  let seenArgs: string[] = [];
  let seenEnv: Record<string, string> | undefined;
  const run = async (args: string[], env?: Record<string, string>) => {
    seenArgs = args;
    seenEnv = env;
    return '{"login":"rrt","id":7,"name":"R","email":null}';
  };
  const id = await ghUserIdentity("github.com", "rrt", "gho_SECRET", run);
  expect(id).toEqual({ name: "R", email: "7+rrt@users.noreply.github.com" });
  expect(seenArgs).toEqual(["api", "user", "--hostname", "github.com"]);
  expect(seenEnv?.GH_TOKEN).toBe("gho_SECRET");
  expect(seenArgs.join(" ")).not.toContain("gho_SECRET");
});
