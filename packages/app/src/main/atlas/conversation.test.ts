import { FACTS_CLOSE, FACTS_OPEN } from "@airlock/agent-core";
import { expect, it, vi } from "vitest";
import { type ChatDeps, sendMessage } from "./conversation";
import {
  openAtlasDb,
  readAskedDay,
  readFacts,
  readTurns,
  writeFacts,
} from "./store";

const reply = (text: string) =>
  JSON.stringify({
    type: "result",
    is_error: false,
    result: text,
    duration_ms: 900,
    modelUsage: { "claude-opus-5": { costUSD: 0.08 } },
  });

const deps = (over: Partial<ChatDeps> = {}): ChatDeps => ({
  db: openAtlasDb(":memory:"),
  spawn: async () => reply("Work on Revaltone-CRM first."),
  now: () => Date.UTC(2026, 7, 30, 18, 0, 0),
  tzOffsetMinutes: () => -360,
  ...over,
});

it("returns the prose reply", async () => {
  const out = await sendMessage(deps(), "what should I do?");
  expect(out).toBe("Work on Revaltone-CRM first.");
});

it("uses Opus, not the Sonnet the debrief uses", async () => {
  const spawn = vi.fn(async () => reply("ok"));
  await sendMessage(deps({ spawn }), "hi");
  const [args] = spawn.mock.calls[0] as unknown as [string[], string];
  expect(args[args.indexOf("--model") + 1]).toContain("opus");
});

it("keeps the cost-saving flags from the debrief path", async () => {
  const spawn = vi.fn(async () => reply("ok"));
  await sendMessage(deps({ spawn }), "hi");
  const [args] = spawn.mock.calls[0] as unknown as [string[], string];
  expect(args).toContain("--strict-mcp-config");
  expect(args).toContain("--disallowed-tools");
});

it("records both the user turn and the reply", async () => {
  const d = deps();
  await sendMessage(d, "what should I do?");
  expect(readTurns(d.db, 10)).toEqual([
    { role: "user", text: "what should I do?" },
    { role: "atlas", text: "Work on Revaltone-CRM first." },
  ]);
});

it("persists a fact the reply captured, and never shows the block", async () => {
  const d = deps({
    spawn: async () =>
      reply(
        `Noted.\n${FACTS_OPEN}\n[{"project":"Muros-Estates","kind":"deadline","value":"2026-09-15","verbatim":"Muros is due the 15th"}]\n${FACTS_CLOSE}`,
      ),
  });
  const out = await sendMessage(d, "Muros is due the 15th");
  expect(out).toBe("Noted.");
  expect(out).not.toContain("{");
  const facts = readFacts(d.db);
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({
    project: "Muros-Estates",
    value: "2026-09-15",
    verbatim: "Muros is due the 15th",
  });
});

it("stores the stripped prose as the turn, not the raw reply", async () => {
  const d = deps({
    spawn: async () => reply(`Noted.\n${FACTS_OPEN}\n[]\n${FACTS_CLOSE}`),
  });
  await sendMessage(d, "hi");
  expect(readTurns(d.db, 10)[1]?.text).toBe("Noted.");
});

it("sends prior turns so the conversation has continuity", async () => {
  const spawn = vi.fn(async () => reply("ok"));
  const d = deps({ spawn });
  await sendMessage(d, "first message");
  await sendMessage(d, "second message");
  const [, stdin] = spawn.mock.calls[1] as unknown as [string[], string];
  expect(stdin).toContain("first message");
  expect(stdin).toContain("second message");
});

it("marks the day when it asked a staleness question", async () => {
  const d = deps();
  const DAY = 24 * 60 * 60 * 1000;
  writeFacts(d.db, [
    {
      id: "f0",
      project: "ezlis",
      kind: "status",
      value: "dead",
      verbatim: "ezlis is dead",
      saidAt: d.now() - 200 * DAY,
      supersededAt: null,
    },
  ]);
  await sendMessage(d, "hi");
  expect(readAskedDay(d.db)).toBe("2026-08-30");
});

it("does not mark the asked day when nothing was stale", async () => {
  const d = deps();
  await sendMessage(d, "hi");
  expect(readAskedDay(d.db)).toBeNull();
});

it("returns null and records nothing when the CLI fails", async () => {
  const d = deps({
    spawn: async () => {
      throw new Error("claude: not found");
    },
  });
  expect(await sendMessage(d, "hi")).toBeNull();
  expect(readTurns(d.db, 10)).toEqual([]);
});
