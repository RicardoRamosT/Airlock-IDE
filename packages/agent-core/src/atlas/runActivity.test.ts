import { describe, expect, it } from "vitest";
import { activityFromEvent, activityFromLine, splitLines } from "./runActivity";

const toolUse = (name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name, input }] },
});

describe("activityFromEvent", () => {
  it("names the tool and the argument worth reading", () => {
    expect(
      activityFromEvent(toolUse("Bash", { command: "git status" })),
    ).toEqual([{ tool: "Bash", detail: "git status" }]);
    expect(
      activityFromEvent(toolUse("Read", { file_path: "/p/app/src/main.ts" })),
    ).toEqual([{ tool: "Read", detail: "/p/app/src/main.ts" }]);
  });

  it("strips the mcp__server__ prefix, which is noise to a reader", () => {
    expect(
      activityFromEvent(toolUse("mcp__airlock__open_tab", { root: "/p/a" })),
    ).toEqual([{ tool: "open_tab", detail: "/p/a" }]);
  });

  it("reports EVERY tool call in one message, not just the first", () => {
    // Parallel tool calls arrive in one assistant event; showing one would
    // under-report what Atlas is doing.
    const ev = {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
          { type: "text", text: "thinking" },
          { type: "tool_use", name: "Grep", input: { pattern: "TODO" } },
        ],
      },
    };
    expect(activityFromEvent(ev)).toEqual([
      { tool: "Bash", detail: "ls" },
      { tool: "Grep", detail: "TODO" },
    ]);
  });

  it("ignores events that are not tool calls", () => {
    expect(activityFromEvent({ type: "system", subtype: "init" })).toEqual([]);
    expect(activityFromEvent({ type: "result", result: "done" })).toEqual([]);
    expect(
      activityFromEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
    ).toEqual([]);
  });

  it("survives shapes it did not expect, since another program emits them", () => {
    for (const bad of [
      null,
      undefined,
      42,
      "assistant",
      { type: "assistant" },
      { type: "assistant", message: 3 },
      { type: "assistant", message: { content: "nope" } },
      { type: "assistant", message: { content: [null, 7] } },
    ]) {
      expect(activityFromEvent(bad)).toEqual([]);
    }
  });

  it("falls back to any short string when the tool is unknown to it", () => {
    expect(
      activityFromEvent(toolUse("SomeNewTool", { whatever: "a value" })),
    ).toEqual([{ tool: "SomeNewTool", detail: "a value" }]);
  });

  it("keeps a row even when there is no argument worth showing", () => {
    expect(activityFromEvent(toolUse("Bash", {}))).toEqual([
      { tool: "Bash", detail: "" },
    ]);
  });

  it("flattens and clips a long command to one readable line", () => {
    const long = `for i in 1 2 3; do\n  echo ${"x".repeat(300)}\ndone`;
    const [a] = activityFromEvent(toolUse("Bash", { command: long }));
    expect(a?.detail).not.toContain("\n");
    expect((a?.detail ?? "").length).toBeLessThanOrEqual(160);
    expect(a?.detail.endsWith("…")).toBe(true);
  });
});

describe("activityFromLine", () => {
  it("parses a complete NDJSON line", () => {
    const line = JSON.stringify(toolUse("Bash", { command: "npm test" }));
    expect(activityFromLine(line)).toEqual([
      { tool: "Bash", detail: "npm test" },
    ]);
  });

  it("yields nothing for a partial or blank line", () => {
    // A killed stream ends mid-line; that is not an error to surface.
    expect(activityFromLine('{"type":"assist')).toEqual([]);
    expect(activityFromLine("")).toEqual([]);
    expect(activityFromLine("   ")).toEqual([]);
  });
});

describe("splitLines", () => {
  it("returns only COMPLETE lines and keeps the remainder", () => {
    // A chunk boundary can fall mid-JSON. Treating one chunk as one line drops
    // events at random, which is worse than showing none.
    expect(splitLines('{"a":1}\n{"b":2}\n{"c":')).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      rest: '{"c":',
    });
  });

  it("holds everything back until a newline arrives", () => {
    expect(splitLines('{"a":1}')).toEqual({ lines: [], rest: '{"a":1}' });
  });

  it("handles a clean boundary", () => {
    expect(splitLines('{"a":1}\n')).toEqual({ lines: ['{"a":1}'], rest: "" });
  });
});
