import { expect, it } from "vitest";
import { costDisclosure, detectCredentialMode } from "./credentials";

it("reports subscription when no credential env vars are set", () => {
  // The author's own machine: both unset, so the Claude subscription pays.
  expect(detectCredentialMode({})).toBe("subscription");
});

it("detects an API key, which bills real money", () => {
  expect(detectCredentialMode({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(
    "api-key",
  );
});

it("detects an auth token", () => {
  expect(detectCredentialMode({ ANTHROPIC_AUTH_TOKEN: "tok" })).toBe(
    "auth-token",
  );
});

it("treats an empty or whitespace value as unset", () => {
  // An exported-but-empty var is a very common shell accident. Treating it as
  // set would show a money warning to someone who is actually on a plan.
  expect(detectCredentialMode({ ANTHROPIC_API_KEY: "" })).toBe("subscription");
  expect(detectCredentialMode({ ANTHROPIC_API_KEY: "   " })).toBe(
    "subscription",
  );
});

it("prefers the API key when both are set, matching the CLI resolution order", () => {
  expect(
    detectCredentialMode({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t" }),
  ).toBe("api-key");
});

it("states cost in money terms for API users and quota terms otherwise", () => {
  expect(costDisclosure("api-key")).toMatch(/bill/i);
  expect(costDisclosure("auth-token")).toMatch(/bill/i);
  expect(costDisclosure("subscription")).toMatch(/quota|plan/i);
  // Never imply money to someone on a plan, or quota to someone paying cash.
  expect(costDisclosure("subscription")).not.toMatch(/\$/);
});
