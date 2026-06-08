import { expect, it } from "vitest";
import { isIgnored } from "./fsWatch";

it("ignores the committed order file (no re-list churn on write)", () => {
  expect(isIgnored("/proj/.airlock-order.json")).toBe(true);
});
it("ignores the vault and VCS/build dirs", () => {
  expect(isIgnored("/proj/.airlock/names.json")).toBe(true);
  expect(isIgnored("/proj/node_modules/x/index.js")).toBe(true);
});
it("does not ignore ordinary source files", () => {
  expect(isIgnored("/proj/src/app.ts")).toBe(false);
});
