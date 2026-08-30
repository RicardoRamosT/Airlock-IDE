import { COMPOSER_MODEL } from "@airlock/agent-core";
import { expect, it, vi } from "vitest";
import { runComposer } from "./composer";

const okJson = JSON.stringify({
  type: "result",
  is_error: false,
  result: "YESTERDAY: you shipped the calendar.",
  duration_ms: 1000,
  modelUsage: { "claude-sonnet-5": { costUSD: 0.03 } },
});

it("sends the prompt on stdin, never in argv", async () => {
  // A portfolio brief can be tens of kilobytes; argv would risk ARG_MAX.
  const spawn = vi.fn(async () => okJson);
  const prompt = "x".repeat(50_000);
  await runComposer(spawn, prompt);
  const [args, stdin] = spawn.mock.calls[0] as unknown as [string[], string];
  expect(stdin).toBe(prompt);
  for (const a of args) expect(a).not.toContain("xxxxxxxxxx");
});

it("passes the cost-saving flags through to the CLI", async () => {
  const spawn = vi.fn(async () => okJson);
  await runComposer(spawn, "hi");
  const [args] = spawn.mock.calls[0] as unknown as [string[], string];
  expect(args).toContain("--strict-mcp-config");
  expect(args).toContain("--disallowed-tools");
  expect(args[args.indexOf("--model") + 1]).toBe(COMPOSER_MODEL);
});

it("returns the parsed result on success", async () => {
  const out = await runComposer(async () => okJson, "hi");
  expect(out?.text).toContain("calendar");
  expect(out?.costUsd).toBeCloseTo(0.03, 5);
});

it("returns null when the CLI fails, leaving any previous brief intact", async () => {
  const out = await runComposer(async () => {
    throw new Error("claude: command not found");
  }, "hi");
  expect(out).toBeNull();
});

it("returns null on unparseable output rather than throwing", async () => {
  expect(await runComposer(async () => "garbage", "hi")).toBeNull();
});
