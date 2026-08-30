import { expect, it } from "vitest";
import {
  buildComposerArgs,
  COMPOSER_DISALLOWED_TOOLS,
  COMPOSER_MODEL,
  COMPOSER_SYSTEM_PROMPT,
} from "./compose";

it("runs in print mode with JSON output", () => {
  const a = buildComposerArgs();
  expect(a).toContain("-p");
  expect(a).toContain("--output-format");
  expect(a[a.indexOf("--output-format") + 1]).toBe("json");
});

it("passes --strict-mcp-config, which is the single biggest cost saving", () => {
  // Measured 2026-08-30: without it a trivial call cost $0.0737; with it,
  // $0.0316. Atlas loads no MCP servers because it needs none.
  expect(buildComposerArgs()).toContain("--strict-mcp-config");
});

it("disallows every tool, because the composer only summarizes text", () => {
  const a = buildComposerArgs();
  const i = a.indexOf("--disallowed-tools");
  expect(i).toBeGreaterThanOrEqual(0);
  for (const tool of COMPOSER_DISALLOWED_TOOLS) expect(a).toContain(tool);
  expect(COMPOSER_DISALLOWED_TOOLS).toContain("Bash");
  expect(COMPOSER_DISALLOWED_TOOLS).toContain("Write");
  expect(COMPOSER_DISALLOWED_TOOLS).toContain("Edit");
});

it("replaces the default system prompt rather than appending to it", () => {
  // --system-prompt replaces; --append-system-prompt would keep the full
  // agentic prompt and roughly double the context.
  const a = buildComposerArgs();
  expect(a).toContain("--system-prompt");
  expect(a).not.toContain("--append-system-prompt");
  expect(a[a.indexOf("--system-prompt") + 1]).toBe(COMPOSER_SYSTEM_PROMPT);
});

it("uses Sonnet by default and accepts an override", () => {
  const a = buildComposerArgs();
  expect(a[a.indexOf("--model") + 1]).toBe(COMPOSER_MODEL);
  expect(COMPOSER_MODEL).toContain("sonnet");
  const b = buildComposerArgs("claude-opus-5");
  expect(b[b.indexOf("--model") + 1]).toBe("claude-opus-5");
});

it("never puts the prompt in argv", () => {
  // The prompt goes on stdin: a portfolio brief can be tens of kilobytes and
  // would risk ARG_MAX. Nothing in argv should look like prose.
  const a = buildComposerArgs();
  for (const arg of a) expect(arg.length).toBeLessThan(400);
});
