import type { CollectDeps } from "@airlock/agent-core";
import { FACTS_CLOSE, FACTS_OPEN } from "@airlock/agent-core";
import { expect, it, vi } from "vitest";
import { type ChatDeps, sendMessage } from "./conversation";
import { directDb } from "./dbOps";
import { openAtlasDb } from "./store";

const reply = (text: string) =>
  JSON.stringify({
    type: "result",
    is_error: false,
    result: text,
    duration_ms: 900,
    modelUsage: { "claude-opus-5": { costUSD: 0.08 } },
  });

const collect = (): CollectDeps => ({
  exists: async () => true,
  isRepo: async () => true,
  status: async () => ({
    branch: { head: "main", upstream: "origin/main", ahead: 34, behind: 0 },
    staged: [],
    unstaged: [],
    untracked: [],
  }),
  log: async () => [],
});

const deps = (over: Partial<ChatDeps> = {}): ChatDeps => ({
  db: directDb(openAtlasDb(":memory:")),
  spawn: async () => reply("Work on Revaltone-CRM first."),
  collect: collect(),
  roots: () => ["/p/Muros-Estates"],
  recents: () => [],
  now: () => Date.UTC(2026, 7, 30, 18, 0, 0),
  tzOffsetMinutes: () => -360,
  ...over,
});

it("returns the prose reply", async () => {
  const out = await sendMessage(deps(), "what should I do?");
  expect(out).toEqual({ ok: true, text: "Work on Revaltone-CRM first." });
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
  expect(await d.db.readTurns(10)).toEqual([
    { role: "user", text: "what should I do?", pending: "settled" },
    { role: "atlas", text: "Work on Revaltone-CRM first.", pending: "settled" },
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
  expect(out).toEqual({ ok: true, text: "Noted." });
  expect(JSON.stringify(out)).not.toContain("facts");
  const facts = await d.db.readFacts();
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
  expect((await d.db.readTurns(10))[1]?.text).toBe("Noted.");
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
  await d.db.writeFacts([
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
  expect(await d.db.readAskedDay()).toBe("2026-08-30");
});

it("does not mark the asked day when nothing was stale", async () => {
  const d = deps();
  await sendMessage(d, "hi");
  expect(await d.db.readAskedDay()).toBeNull();
});

it("KEEPS the question, marked unanswered, when the CLI fails", async () => {
  const d = deps({
    spawn: async () => {
      throw new Error("claude: not found");
    },
  });
  // The REASON now reaches the caller, not just the event log: the card used
  // to say "Could not reach Claude" for every failure, including this one.
  expect(await sendMessage(d, "hi")).toEqual({
    ok: false,
    error: "claude: not found",
  });
  // The question was real and stays visible -- it used to vanish, which is how
  // an in-flight message disappeared when the panel was closed.
  expect(await d.db.readTurns(10)).toEqual([
    { role: "user", text: "hi", pending: "unanswered" },
  ]);
});

it("collects the portfolio itself when today has no snapshot yet", async () => {
  // The bug this pins: the chat used to read a snapshot that ONLY the debrief
  // path ever wrote, so before the day's brief ran Atlas told the user "the
  // portfolio is empty" and asked them to send the data by hand.
  const spawn = vi.fn(async () => reply("ok"));
  await sendMessage(deps({ spawn }), "what should I do?");
  const [, stdin] = spawn.mock.calls[0] as unknown as [string[], string];
  expect(stdin).toContain("Muros-Estates");
  expect(stdin).toContain("34 unpushed");
});

it("reuses today's snapshot instead of re-collecting on every message", async () => {
  const exists = vi.fn(async () => true);
  const d = deps({ collect: { ...collect(), exists } });
  await sendMessage(d, "one");
  const afterFirst = exists.mock.calls.length;
  expect(afterFirst).toBeGreaterThan(0);
  await sendMessage(d, "two");
  expect(exists.mock.calls.length).toBe(afterFirst);
});

it("still answers when collection throws, rather than failing the turn", async () => {
  const spawn = vi.fn(async () => reply("ok"));
  const d = deps({
    spawn,
    collect: {
      ...collect(),
      exists: async () => {
        throw new Error("disk gone");
      },
    },
  });
  expect(await sendMessage(d, "hi")).toEqual({ ok: true, text: "ok" });
});

it("seeds from recentFolders too, not only open windows", async () => {
  // The bug this pins: the chat passed recentFolders: [] and seeded ONLY from
  // open windows. With no project window focused that is zero roots, so Atlas
  // reported an empty portfolio while 21 repositories sat in recents.
  const spawn = vi.fn(async () => reply("ok"));
  await sendMessage(
    deps({ spawn, roots: () => [], recents: () => ["/p/ElArqui"] }),
    "hi",
  );
  const [, stdin] = spawn.mock.calls[0] as unknown as [string[], string];
  expect(stdin).toContain("ElArqui");
});

it("re-collects when the cached snapshot is EMPTY", async () => {
  // An empty collection must not poison the whole day. The first attempt ran
  // with no roots and cached [], and every later message reused it.
  const d = deps({ roots: () => [], recents: () => [] });
  await sendMessage(d, "first");
  const spawn = vi.fn(async () => reply("ok"));
  d.spawn = spawn;
  d.roots = () => ["/p/Muros-Estates"];
  await sendMessage(d, "second");
  const [, stdin] = spawn.mock.calls[0] as unknown as [string[], string];
  expect(stdin).toContain("Muros-Estates");
});

it("collects a WEEK of history, not a day", async () => {
  // "What did I do this week" was unanswerable by construction: the window was
  // 24 hours.
  let since = 0;
  const d = deps({
    collect: {
      ...collect(),
      log: async (_r, sinceMs) => {
        since = sinceMs;
        return [];
      },
    },
  });
  const now = d.now();
  await sendMessage(d, "summarize my week");
  const days = Math.round((now - since) / (24 * 60 * 60 * 1000));
  expect(days).toBe(7);
});

it("lets Atlas use tools when talking", async () => {
  const spawn = vi.fn(async () => reply("ok"));
  await sendMessage(deps({ spawn }), "hi");
  const [args] = spawn.mock.calls[0] as unknown as [string[], string];
  expect(args).toContain("--allowed-tools");
  expect(args).toContain("Bash");
  expect(args).not.toContain("--append-system-prompt");
});

it("still returns the reply when the store fails, instead of losing it", async () => {
  // On 2026-08-30 18:51 the database host aborted mid-write. sendMessage threw,
  // the user saw "Could not reach Claude", and a reply Claude had spent 73
  // seconds producing was discarded -- while Claude had in fact answered fine.
  const d = deps();
  const dead = new Error("atlas db host exited (5)");
  d.db.appendTurns = async () => {
    throw dead;
  };
  await expect(sendMessage(d, "what should I do?")).resolves.toEqual({
    ok: true,
    text: "Work on Revaltone-CRM first.",
  });
});

it("does not let a failed FACT write discard the reply either", async () => {
  const d = deps({
    spawn: async () =>
      reply(
        `Noted.\n${FACTS_OPEN}\n[{"project":"ElArqui","kind":"deadline","value":"2026-09-15","verbatim":"ElArqui is due the 15th"}]\n${FACTS_CLOSE}`,
      ),
  });
  d.db.writeFacts = async () => {
    throw new Error("atlas db host exited (5)");
  };
  expect(await sendMessage(d, "ElArqui is due the 15th")).toEqual({
    ok: true,
    text: "Noted.",
  });
});

it("passes the abort signal to the CLI, so Escape can kill it", async () => {
  const ac = new AbortController();
  const spawn = vi.fn(
    async (_args: string[], _stdin: string, _signal?: AbortSignal) =>
      reply("hi"),
  );
  await sendMessage({ ...deps({ spawn }), signal: ac.signal }, "hello");
  expect(spawn.mock.calls[0]?.[2]).toBe(ac.signal);
});

it("DISCARDS the question on a cancel, because it goes back to the composer", async () => {
  // Escape is the user getting what they asked for. Logging it as an error
  // would bury the real ones.
  const ac = new AbortController();
  ac.abort();
  const d = {
    ...deps({
      spawn: async () => {
        throw new Error("atlas: cancelled");
      },
    }),
    signal: ac.signal,
  };
  expect(await sendMessage(d, "never mind")).toBeNull();
  // Discarded, not kept as unanswered: the renderer puts the text back in the
  // composer, so keeping it here too would show it in two places at once.
  expect(await d.db.readTurns(10)).toEqual([]);
});

it("records a concern Atlas raised in its reply", async () => {
  const d = deps({
    spawn: async () =>
      reply(
        `Found something.\n<<<ATLAS_CONCERNS\n[{"key":"elarqui-ipv6","project":"ElArqui","title":"apex answers on IPv6","detail":"Render is IPv4 only."}]\nATLAS_CONCERNS>>>`,
      ),
  });
  expect(await sendMessage(d, "check ElArqui")).toEqual({
    ok: true,
    text: "Found something.",
  });
  const [c] = await d.db.readConcerns();
  expect(c).toMatchObject({
    key: "elarqui-ipv6",
    source: "atlas",
    firstValue: null,
    resolvedAt: null,
  });
});

it("keeps the raw block out of what the user reads", async () => {
  const d = deps({
    spawn: async () =>
      reply(
        `Done.\n<<<ATLAS_CONCERNS\n[{"key":"k","title":"t"}]\nATLAS_CONCERNS>>>`,
      ),
  });
  expect(await sendMessage(d, "hi")).toEqual({ ok: true, text: "Done." });
});

it("cannot close a concern measured from git", async () => {
  // The boundary: a model saying "no-remote is fixed" would clear a real
  // warning nothing had fixed. Only the detector can resolve that one.
  const d = deps({
    spawn: async () =>
      reply(
        `All good.\n<<<ATLAS_CONCERNS\n[{"key":"/p/airlock|no-remote","title":"fine now","resolved":true}]\nATLAS_CONCERNS>>>`,
      ),
  });
  await d.db.writeConcerns([
    {
      key: "/p/airlock|no-remote",
      source: "git",
      root: "/p/airlock",
      project: "airlock",
      title: "no remote",
      detail: "",
      firstSeenAt: 1,
      lastSeenAt: 2,
      firstValue: 28,
      lastValue: 44,
      resolvedAt: null,
    },
  ]);
  await sendMessage(d, "is airlock ok?");
  const [c] = await d.db.readConcerns();
  expect(c?.resolvedAt).toBeNull();
  expect(c?.title).toBe("no remote"); // not reworded either
});
