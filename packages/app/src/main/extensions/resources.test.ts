import { expect, it } from "vitest";
import { eyeOnConnected } from "./resources";

const D = [
  {
    id: "slack",
    name: "Slack",
    category: "activity",
    configSchema: { fields: [] },
  },
  {
    id: "github",
    name: "GitHub",
    category: "git",
    configSchema: { fields: [] },
  },
] as never;

it("includes only enabled + eye-on (pinned) descriptors", () => {
  const prefs = { slack: { pinned: true }, github: { pinned: false } };
  expect(eyeOnConnected(D, prefs).map((d) => d.id)).toEqual(["slack"]);
});

it("treats missing enabled as enabled, missing pinned as off", () => {
  expect(eyeOnConnected(D, {}).map((d) => d.id)).toEqual([]);
  expect(
    eyeOnConnected(D, { slack: { enabled: false, pinned: true } }).map(
      (d) => d.id,
    ),
  ).toEqual([]);
});
