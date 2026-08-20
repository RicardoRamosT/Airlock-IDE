import { describe, expect, it } from "vitest";
import type { GhAccount } from "../github/accounts";
import { parseRemote } from "./remote";
import {
  autoSwitchTarget,
  type ResolvedAccount,
  resolveProjectAccount,
} from "./resolve";

const accounts: GhAccount[] = [
  { host: "github.com", username: "octocat", active: true },
  { host: "github.com", username: "hubber", active: false },
];
const origin = (u: string) => parseRemote(u);

it("auto-detects the account whose login matches the origin owner", () => {
  const r = resolveProjectAccount(
    undefined,
    origin("https://github.com/octocat/hello-world.git"),
    accounts,
  );
  expect(r).toEqual({
    account: { host: "github.com", username: "octocat" },
    source: "auto",
    protocol: "https",
  });
});

it("returns none for an org repo with no matching login", () => {
  const r = resolveProjectAccount(
    undefined,
    origin("https://github.com/acme/widgets.git"),
    accounts,
  );
  expect(r.account).toBeNull();
  expect(r.source).toBe("none");
});

it("prefers a valid override over auto-detect", () => {
  const r = resolveProjectAccount(
    { host: "github.com", username: "hubber" },
    origin("https://github.com/octocat/hello-world.git"),
    accounts,
  );
  expect(r.account?.username).toBe("hubber");
  expect(r.source).toBe("override");
});

it("ignores an override pointing at a logged-out account", () => {
  const r = resolveProjectAccount(
    { host: "github.com", username: "ghost" },
    origin("https://github.com/octocat/x.git"),
    accounts,
  );
  expect(r.source).toBe("auto");
  expect(r.account?.username).toBe("octocat");
});

it("reports ssh protocol and no remote", () => {
  expect(
    resolveProjectAccount(
      undefined,
      origin("git@github.com:octocat/x.git"),
      accounts,
    ).protocol,
  ).toBe("ssh");
  expect(resolveProjectAccount(undefined, null, accounts)).toEqual({
    account: null,
    source: "none",
    protocol: "unknown",
  });
});

describe("autoSwitchTarget", () => {
  const pool: GhAccount[] = [
    { host: "github.com", username: "vnricardotrevino", active: true },
    { host: "github.com", username: "RicardoRamosT", active: false },
  ];
  const pinned: ResolvedAccount = {
    account: { host: "github.com", username: "RicardoRamosT" },
    source: "override",
    protocol: "https",
  };
  const auto: ResolvedAccount = {
    account: { host: "github.com", username: "RicardoRamosT" },
    source: "auto",
    protocol: "https",
  };
  const none: ResolvedAccount = {
    account: null,
    source: "none",
    protocol: "https",
  };

  it("never switches for a PINNED project, even when the active account differs", () => {
    expect(autoSwitchTarget(pinned, pool, true, "")).toBeNull();
    expect(autoSwitchTarget(pinned, pool, false, "")).toBeNull();
  });

  it("switches a non-pinned project to its detected account", () => {
    expect(autoSwitchTarget(auto, pool, true, "")).toEqual({
      host: "github.com",
      username: "RicardoRamosT",
    });
  });

  it("stays put when the pref is off", () => {
    expect(autoSwitchTarget(auto, pool, false, "")).toBeNull();
  });

  it("stays put when the target is already active", () => {
    const already: ResolvedAccount = {
      account: { host: "github.com", username: "vnricardotrevino" },
      source: "auto",
      protocol: "https",
    };
    expect(autoSwitchTarget(already, pool, true, "")).toBeNull();
  });

  it("falls back to the commit name for an ORG repo, case-insensitively", () => {
    expect(autoSwitchTarget(none, pool, true, "ricardoramost")).toEqual({
      host: "github.com",
      username: "RicardoRamosT",
    });
  });

  it("stays put when nothing resolves", () => {
    expect(autoSwitchTarget(none, pool, true, "")).toBeNull();
    expect(autoSwitchTarget(none, pool, true, "nobody")).toBeNull();
  });
});
