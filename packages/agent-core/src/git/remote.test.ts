import { expect, it } from "vitest";
import { parseRemote } from "./remote";

it("parses https remotes with and without .git", () => {
  expect(
    parseRemote("https://github.com/RicardoRamosT/Airlock-IDE.git"),
  ).toEqual({
    host: "github.com",
    owner: "RicardoRamosT",
    repo: "Airlock-IDE",
    protocol: "https",
  });
  expect(parseRemote("https://github.com/ViewNear/lend")).toEqual({
    host: "github.com",
    owner: "ViewNear",
    repo: "lend",
    protocol: "https",
  });
});

it("parses scp-style and ssh:// remotes as ssh", () => {
  expect(parseRemote("git@github.com:RicardoRamosT/Airlock-IDE.git")).toEqual({
    host: "github.com",
    owner: "RicardoRamosT",
    repo: "Airlock-IDE",
    protocol: "ssh",
  });
  expect(parseRemote("ssh://git@github.com/ViewNear/lend.git")).toEqual({
    host: "github.com",
    owner: "ViewNear",
    repo: "lend",
    protocol: "ssh",
  });
});

it("returns null for unrecognized input", () => {
  expect(parseRemote("")).toBeNull();
  expect(parseRemote("not a url")).toBeNull();
});
