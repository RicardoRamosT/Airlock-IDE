import { expect, it } from "vitest";
import { parseComposerOutput } from "./result";

const ok = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "YESTERDAY: you shipped the calendar.",
    duration_ms: 1324,
    modelUsage: { "claude-sonnet-5": { costUSD: 0.0316 } },
    ...over,
  });

it("extracts the text, cost and duration from a successful run", () => {
  expect(parseComposerOutput(ok())).toEqual({
    text: "YESTERDAY: you shipped the calendar.",
    costUsd: 0.0316,
    durationMs: 1324,
  });
});

it("returns null when the CLI reports an error", () => {
  expect(parseComposerOutput(ok({ is_error: true }))).toBeNull();
});

it("returns null for an empty result rather than storing a blank brief", () => {
  // A blank brief would show an empty popover and look like a crash.
  expect(parseComposerOutput(ok({ result: "" }))).toBeNull();
  expect(parseComposerOutput(ok({ result: "   " }))).toBeNull();
});

it("returns null rather than throwing on non-JSON output", () => {
  expect(parseComposerOutput("not json at all")).toBeNull();
  expect(parseComposerOutput("")).toBeNull();
});

it("tolerates a missing modelUsage block", () => {
  const out = parseComposerOutput(ok({ modelUsage: undefined }));
  expect(out?.costUsd).toBe(0);
  expect(out?.text).toContain("calendar");
});

it("sums cost across models when more than one ran", () => {
  const out = parseComposerOutput(
    ok({
      modelUsage: {
        "claude-sonnet-5": { costUSD: 0.03 },
        "claude-haiku-4-5": { costUSD: 0.01 },
      },
    }),
  );
  expect(out?.costUsd).toBeCloseTo(0.04, 5);
});

it("ignores leading CLI warning lines before the JSON", () => {
  // node:sqlite and other subsystems print ExperimentalWarning to stderr, but
  // a stray stdout line must not break the parse.
  const out = parseComposerOutput(`some noise\n${ok()}`);
  expect(out?.text).toContain("calendar");
});
