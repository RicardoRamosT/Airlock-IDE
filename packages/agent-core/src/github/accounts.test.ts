import { describe, expect, it } from "vitest";
import { parseGhAuthStatus, switchGhAccount } from "./accounts";

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
