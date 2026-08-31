import { describe, expect, it } from "vitest";
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

// --- stream-json (the chat path) -----------------------------------------
// Fixtures taken from a real `claude -p --output-format stream-json --verbose`
// run on 2026-08-31, not invented: the chat switched to streaming so a long
// run can be told apart from a wedged one.
describe("stream-json output", () => {
  const line = (o: unknown) => `${JSON.stringify(o)}\n`;
  const RESULT = {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    duration_ms: 4200,
    modelUsage: { "claude-opus-5": { costUSD: 0.5 } },
  };

  it("reads the reply from the final result event", () => {
    const raw =
      line({ type: "system", subtype: "init" }) +
      line({ type: "system", estimated_tokens_delta: 12 }) +
      line({ type: "assistant", message: { content: [] } }) +
      line(RESULT);
    expect(parseComposerOutput(raw)).toEqual({
      text: "ok",
      costUsd: 0.5,
      durationMs: 4200,
    });
  });

  it("ignores assistant and system lines that precede it", () => {
    // The old parser sliced from the FIRST '{' to EOF and handed JSON.parse a
    // whole concatenated stream, which always failed -- an unparseable output,
    // reported to the user as "Could not reach Claude".
    const raw =
      line({ type: "assistant", message: { content: [{ text: "nope" }] } }) +
      line({ ...RESULT, result: "the real answer" });
    expect(parseComposerOutput(raw)?.text).toBe("the real answer");
  });

  it("returns null when the stream was cut before its result line", () => {
    // A SIGKILLed run leaves complete event lines but no result. Accepting a
    // partial stream would show a half-answer as if it were the whole one.
    const raw =
      line({ type: "system", subtype: "init" }) +
      line({ type: "assistant", message: { content: [] } });
    expect(parseComposerOutput(raw)).toBeNull();
  });

  it("survives a truncated final line", () => {
    const raw = line(RESULT) + '{"type":"result","result":"trunc';
    expect(parseComposerOutput(raw)?.text).toBe("ok");
  });

  it("still reports an errored result as a failure", () => {
    expect(parseComposerOutput(line({ ...RESULT, is_error: true }))).toBeNull();
  });

  it("still parses the single-object form the brief uses", () => {
    // Both formats reach this parser; switching the chat must not break the
    // daily brief, which still uses --output-format json.
    const raw = `\n${JSON.stringify({ ...RESULT, type: undefined })}`;
    expect(parseComposerOutput(raw)?.text).toBe("ok");
  });
});
