import { expect, it } from "vitest";
import { parseRemote } from "./remote";

it("parses https remotes with and without .git", () => {
  expect(parseRemote("https://github.com/octocat/hello-world.git")).toEqual({
    host: "github.com",
    owner: "octocat",
    repo: "hello-world",
    protocol: "https",
  });
  expect(parseRemote("https://github.com/acme/widgets")).toEqual({
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    protocol: "https",
  });
});

it("parses scp-style and ssh:// remotes as ssh", () => {
  expect(parseRemote("git@github.com:octocat/hello-world.git")).toEqual({
    host: "github.com",
    owner: "octocat",
    repo: "hello-world",
    protocol: "ssh",
  });
  expect(parseRemote("ssh://git@github.com/acme/widgets.git")).toEqual({
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    protocol: "ssh",
  });
});

it("returns null for unrecognized input", () => {
  expect(parseRemote("")).toBeNull();
  expect(parseRemote("not a url")).toBeNull();
});
