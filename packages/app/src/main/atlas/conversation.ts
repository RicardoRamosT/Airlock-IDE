// ASCII comments only. One conversational turn end to end.
//
// A turn is ONE request: the reply and any facts it captured come back
// together in a trailing block. Extracting facts with a second call would
// double the cost of the thing the user does most.
//
// Nothing is recorded when the call fails. A half-written turn -- a user
// message with no reply -- would poison the history that every later turn
// resends. That guard covers a failed SPAWN; it cannot cover a failed WRITE,
// so the pair is written through appendTurns in a single transaction. An
// abort mid-pair (which is how this was found) then leaves neither turn.

import {
  buildChatArgs,
  buildChatPrompt,
  type CollectDeps,
  MAX_HISTORY_TURNS,
  mergeFacts,
  parseComposerOutput,
  pickDailyQuestion,
  questionFor,
  type RootSnapshot,
  splitReply,
} from "@airlock/agent-core";
import { emitEvent } from "../eventlog/wire";
import type { SpawnFn } from "./composer";
import type { AtlasDb } from "./dbOps";
import { refreshPortfolio } from "./refresh";
// dayKey is pure; everything else now crosses the process boundary.
import { dayKey } from "./store";

export interface ChatDeps {
  db: AtlasDb;
  spawn: SpawnFn;
  collect: CollectDeps;
  roots(): string[];
  recents(): string[];
  // AirLock's own MCP endpoint, when the server is up. Absent -> Atlas simply
  // has no IDE tools that turn, which is a smaller capability, not an error.
  mcp?(): { port: number; token: string } | null;
  now(): number;
  tzOffsetMinutes(): number;
  // Set when the user presses Escape. Kills the CLI rather than only
  // abandoning the wait.
  signal?: AbortSignal;
}

// A week. 24h made 'what did I do this week' unanswerable by construction.
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// The conversation must never depend on the DEBRIEF path having run. It used
// to read a snapshot that only refreshPortfolio wrote, so before the day's
// brief existed Atlas answered "the portfolio is empty" and asked the user to
// paste their projects in by hand. Collect on demand, once per day.
async function portfolioFor(
  deps: ChatDeps,
  today: string,
  now: number,
): Promise<RootSnapshot[]> {
  // An EMPTY snapshot is not a valid cache hit. The first attempt can run with
  // no roots yet (no project window focused), and caching that answer poisoned
  // the entire day: every later message reused it and Atlas kept insisting the
  // portfolio was empty.
  const wantedSince = now - WINDOW_MS;
  const existing = await deps.db.readSnapshot(today, wantedSince);
  if (existing !== null && existing.length > 0) return existing;
  try {
    return await refreshPortfolio({
      db: deps.db,
      deps: deps.collect,
      recentFolders: deps.recents(),
      openTabRoots: deps.roots(),
      now,
      tzOffsetMinutes: deps.tzOffsetMinutes(),
      sinceMs: wantedSince,
    });
  } catch {
    // A failed collection degrades to no portfolio; the turn still answers.
    return [];
  }
}

export async function sendMessage(
  deps: ChatDeps,
  message: string,
): Promise<string | null> {
  const now = deps.now();
  const today = dayKey(now, deps.tzOffsetMinutes());

  const facts = await deps.db.readFacts();
  const stale = pickDailyQuestion(
    facts,
    now,
    await deps.db.readAskedDay(),
    today,
  );
  const prompt = buildChatPrompt({
    history: await deps.db.readTurns(MAX_HISTORY_TURNS),
    facts,
    snaps: await portfolioFor(deps, today, now),
    question: stale ? questionFor(stale, now) : null,
    message,
  });

  // Write the question NOW, before the model is spawned. Until this existed the
  // message lived only as optimistic state in the panel, so closing it mid-run
  // lost sight of it entirely until the reply landed minutes later.
  const seq = await deps.db.beginTurn(message, now);

  let raw: string;
  try {
    raw = await deps.spawn(
      buildChatArgs(deps.roots(), deps.mcp?.() ?? undefined),
      prompt,
      deps.signal,
    );
  } catch (e) {
    // A user pressing Escape is not a failure and must not be logged as one --
    // and the renderer hands the message back to the composer, so the pending
    // turn is DISCARDED rather than kept as unanswered. Keeping it would show
    // the same sentence in the log and the input box at once.
    if (deps.signal?.aborted) {
      await deps.db.discardTurn(seq).catch(() => {});
      return null;
    }
    await deps.db.abandonTurn(seq).catch(() => {});
    // Do not swallow it: a silent "Could not reach Claude" is unactionable.
    emitEvent({
      level: "error",
      category: "atlas",
      op: "atlas.chat",
      outcome: "error",
      detail: { reason: e instanceof Error ? e.message : String(e) },
    });
    return null;
  }

  const result = parseComposerOutput(raw);
  if (result === null) {
    await deps.db.abandonTurn(seq).catch(() => {});
    emitEvent({
      level: "error",
      category: "atlas",
      op: "atlas.chat",
      outcome: "error",
      detail: { reason: "unparseable output", head: raw.slice(0, 300) },
    });
    return null;
  }

  const { prose, facts: incoming } = splitReply(result.text);

  // THE ANSWER IS NOT LOST IF THE STORE FAILS.
  //
  // Persisting can fail on its own now that the database is a separate process
  // that is allowed to die (see dbHost.ts). It did, on 2026-08-30 at 18:51:
  // the host aborted while writing, sendMessage threw, and the user was shown
  // "Could not reach Claude" -- for a reply Claude had spent 73 seconds
  // producing, which was then discarded. Claude HAD been reached.
  //
  // So the reply is returned either way. An unsaved turn means the next turn
  // will not see it, which is a real but far smaller loss than throwing away
  // the answer and blaming the wrong component.
  try {
    await deps.db.completeTurn(seq, prose, now);
    if (incoming.length > 0) {
      await deps.db.writeFacts(
        mergeFacts(facts, incoming, now, (n) => `${now}-${n}`),
      );
    }
    // Only mark the day if a question was actually asked, so a quiet day does
    // not consume the one question it was entitled to.
    if (stale) await deps.db.writeAskedDay(today);
  } catch (e) {
    emitEvent({
      level: "error",
      category: "atlas",
      op: "atlas.persist",
      outcome: "error",
      detail: {
        reason: e instanceof Error ? e.message : String(e),
        // So the log says what was lost, not merely that something was.
        replyChars: prose.length,
        facts: incoming.length,
      },
    });
  }

  return prose;
}
