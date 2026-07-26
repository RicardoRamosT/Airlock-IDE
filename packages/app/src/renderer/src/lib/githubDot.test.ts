import { describe, expect, it } from "vitest";
import type { GithubInfo, ResolvedGithubAccount } from "../../../shared/ipc";
import { githubAccountDot } from "./githubDot";

const info = (
  accounts: { host: string; username: string; active: boolean }[],
  installed = true,
): GithubInfo =>
  ({
    gh: { installed, accounts },
    identity: { name: null, email: null },
  }) as GithubInfo;

const resolved = (
  account: { host: string; username: string } | null,
  source: ResolvedGithubAccount["source"],
  protocol: ResolvedGithubAccount["protocol"] = "https",
): ResolvedGithubAccount => ({ account, source, protocol });

describe("githubAccountDot", () => {
  it("green when the auto-detected account for the repo IS the active one", () => {
    const dot = githubAccountDot(
      info([
        { host: "github.com", username: "me", active: true },
        { host: "github.com", username: "other", active: false },
      ]),
      resolved({ host: "github.com", username: "me" }, "auto"),
    );
    expect(dot?.level).toBe("green");
    expect(dot?.title).toContain("me");
  });

  it("yellow when a DIFFERENT account is active than the repo wants", () => {
    const dot = githubAccountDot(
      info([
        { host: "github.com", username: "other", active: true },
        { host: "github.com", username: "me", active: false },
      ]),
      resolved({ host: "github.com", username: "me" }, "auto"),
    );
    expect(dot?.level).toBe("yellow");
    // Names both the wrong active account and the one this repo wants.
    expect(dot?.title).toContain("other");
    expect(dot?.title).toContain("me");
  });

  it("green when the project is PINNED, even if another account is active", () => {
    // A pinned repo serves the pinned token via its local credential helper, so
    // the machine's active account cannot break it.
    const dot = githubAccountDot(
      info([
        { host: "github.com", username: "other", active: true },
        { host: "github.com", username: "pinned", active: false },
      ]),
      resolved({ host: "github.com", username: "pinned" }, "override"),
    );
    expect(dot?.level).toBe("green");
    expect(dot?.title).toContain("pinned");
  });

  it("says SSH pins set the commit identity only", () => {
    const dot = githubAccountDot(
      info([{ host: "github.com", username: "me", active: true }]),
      resolved({ host: "github.com", username: "me" }, "override", "ssh"),
    );
    expect(dot?.level).toBe("green");
    expect(dot?.title).toContain("SSH");
  });

  it("compares usernames case-insensitively, hosts exactly", () => {
    expect(
      githubAccountDot(
        info([{ host: "github.com", username: "Me", active: true }]),
        resolved({ host: "github.com", username: "me" }, "auto"),
      )?.level,
    ).toBe("green");
    // Same login on a DIFFERENT host is a different account -> not a match.
    expect(
      githubAccountDot(
        info([{ host: "ghe.corp", username: "me", active: true }]),
        resolved({ host: "github.com", username: "me" }, "auto"),
      )?.level,
    ).toBe("yellow");
  });

  it("yellow when the repo wants an account but none is active", () => {
    const dot = githubAccountDot(
      info([{ host: "github.com", username: "me", active: false }]),
      resolved({ host: "github.com", username: "me" }, "auto"),
    );
    expect(dot?.level).toBe("yellow");
  });

  it("no dot when there is nothing to report (unknown must not read as wrong)", () => {
    const accounts = [{ host: "github.com", username: "me", active: true }];
    // gh not installed
    expect(githubAccountDot(info(accounts, false), null)).toBeNull();
    // no info yet (still loading)
    expect(
      githubAccountDot(null, resolved({ host: "h", username: "u" }, "auto")),
    ).toBeNull();
    // no project focused -> nothing resolved
    expect(githubAccountDot(info(accounts), null)).toBeNull();
    // no remote / org repo with no matching login
    expect(githubAccountDot(info(accounts), resolved(null, "none"))).toBeNull();
    // defensive: source says auto but no account came back
    expect(githubAccountDot(info(accounts), resolved(null, "auto"))).toBeNull();
  });
});
