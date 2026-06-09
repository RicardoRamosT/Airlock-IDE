import { expect, it } from "vitest";
import type { GhAccount } from "../github/accounts";
import { parseRemote } from "./remote";
import { resolveProjectAccount } from "./resolve";

const accounts: GhAccount[] = [
  { host: "github.com", username: "RicardoRamosT", active: true },
  { host: "github.com", username: "vnricardotrevino", active: false },
];
const origin = (u: string) => parseRemote(u);

it("auto-detects the account whose login matches the origin owner", () => {
  const r = resolveProjectAccount(
    undefined,
    origin("https://github.com/RicardoRamosT/Airlock-IDE.git"),
    accounts,
  );
  expect(r).toEqual({
    account: { host: "github.com", username: "RicardoRamosT" },
    source: "auto",
    protocol: "https",
  });
});

it("returns none for an org repo with no matching login", () => {
  const r = resolveProjectAccount(
    undefined,
    origin("https://github.com/ViewNear/lend.git"),
    accounts,
  );
  expect(r.account).toBeNull();
  expect(r.source).toBe("none");
});

it("prefers a valid override over auto-detect", () => {
  const r = resolveProjectAccount(
    { host: "github.com", username: "vnricardotrevino" },
    origin("https://github.com/RicardoRamosT/Airlock-IDE.git"),
    accounts,
  );
  expect(r.account?.username).toBe("vnricardotrevino");
  expect(r.source).toBe("override");
});

it("ignores an override pointing at a logged-out account", () => {
  const r = resolveProjectAccount(
    { host: "github.com", username: "ghost" },
    origin("https://github.com/RicardoRamosT/x.git"),
    accounts,
  );
  expect(r.source).toBe("auto");
  expect(r.account?.username).toBe("RicardoRamosT");
});

it("reports ssh protocol and no remote", () => {
  expect(
    resolveProjectAccount(
      undefined,
      origin("git@github.com:RicardoRamosT/x.git"),
      accounts,
    ).protocol,
  ).toBe("ssh");
  expect(resolveProjectAccount(undefined, null, accounts)).toEqual({
    account: null,
    source: "none",
    protocol: "unknown",
  });
});
