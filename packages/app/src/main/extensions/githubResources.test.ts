import { expect, it } from "vitest";
import {
  issuesToItems,
  parseGithubRemote,
  parseIssuesPayload,
} from "./githubResources";

it("parses https and ssh github remotes; ignores non-github", () => {
  expect(parseGithubRemote("https://github.com/acme/widget.git")).toEqual({
    owner: "acme",
    repo: "widget",
  });
  expect(parseGithubRemote("git@github.com:acme/widget.git")).toEqual({
    owner: "acme",
    repo: "widget",
  });
  expect(parseGithubRemote("https://github.com/acme/widget")).toEqual({
    owner: "acme",
    repo: "widget",
  });
  expect(parseGithubRemote("https://gitlab.com/acme/widget.git")).toBeNull();
  expect(parseGithubRemote(null)).toBeNull();
});

it("splits issues vs PRs and maps to IntegrationItems (PRs first)", () => {
  const rows = parseIssuesPayload([
    { number: 7, title: "Bug", html_url: "u7" },
    { number: 9, title: "Feat", html_url: "u9", pull_request: { url: "p" } },
  ]);
  expect(rows).toEqual([
    { number: 7, title: "Bug", url: "u7", isPr: false },
    { number: 9, title: "Feat", url: "u9", isPr: true },
  ]);
  const items = issuesToItems(rows);
  expect(items.map((i) => i.id)).toEqual([
    "int:github:pr:9",
    "int:github:issue:7",
  ]);
  expect(items[0]).toMatchObject({
    title: "#9 Feat",
    subtitle: "pull request",
    state: "idle",
    href: "u9",
  });
});

it("parseIssuesPayload tolerates junk", () => {
  expect(parseIssuesPayload(null)).toEqual([]);
  expect(
    parseIssuesPayload([{}, { number: 1, title: "x", html_url: "u" }]),
  ).toEqual([{ number: 1, title: "x", url: "u", isPr: false }]);
});
