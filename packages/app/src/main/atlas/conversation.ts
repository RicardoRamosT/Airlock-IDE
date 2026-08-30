// ASCII comments only. One conversational turn end to end.
//
// A turn is ONE request: the reply and any facts it captured come back
// together in a trailing block. Extracting facts with a second call would
// double the cost of the thing the user does most.
//
// Nothing is recorded when the call fails. A half-written turn -- a user
// message with no reply -- would poison the history that every later turn
// resends.

import type { DatabaseSync } from "node:sqlite";
import {
  buildChatPrompt,
  buildComposerArgs,
  CHAT_MODEL,
  CHAT_SYSTEM_PROMPT,
  type CollectDeps,
  MAX_HISTORY_TURNS,
  mergeFacts,
  parseComposerOutput,
  pickDailyQuestion,
  questionFor,
  type RootSnapshot,
  splitReply,
} from "@airlock/agent-core";
import type { SpawnFn } from "./composer";
import { refreshPortfolio } from "./refresh";
import {
  appendTurn,
  dayKey,
  readAskedDay,
  readFacts,
  readSnapshot,
  readTurns,
  writeAskedDay,
  writeFacts,
} from "./store";

export interface ChatDeps {
  db: DatabaseSync;
  spawn: SpawnFn;
  collect: CollectDeps;
  roots(): string[];
  now(): number;
  tzOffsetMinutes(): number;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

// The conversation must never depend on the DEBRIEF path having run. It used
// to read a snapshot that only refreshPortfolio wrote, so before the day's
// brief existed Atlas answered "the portfolio is empty" and asked the user to
// paste their projects in by hand. Collect on demand, once per day.
async function portfolioFor(
  deps: ChatDeps,
  today: string,
  now: number,
): Promise<RootSnapshot[]> {
  const existing = readSnapshot(deps.db, today);
  if (existing !== null) return existing;
  try {
    return await refreshPortfolio({
      db: deps.db,
      deps: deps.collect,
      recentFolders: [],
      openTabRoots: deps.roots(),
      now,
      tzOffsetMinutes: deps.tzOffsetMinutes(),
      sinceMs: now - WINDOW_MS,
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

  const facts = readFacts(deps.db);
  const stale = pickDailyQuestion(facts, now, readAskedDay(deps.db), today);
  const prompt = buildChatPrompt({
    history: readTurns(deps.db, MAX_HISTORY_TURNS),
    facts,
    snaps: await portfolioFor(deps, today, now),
    question: stale ? questionFor(stale, now) : null,
    message,
  });

  let raw: string;
  try {
    // Plan 2's argv builder, reused: identical cost flags, different model and
    // system prompt.
    raw = await deps.spawn(
      buildComposerArgs(CHAT_MODEL, CHAT_SYSTEM_PROMPT),
      prompt,
    );
  } catch {
    return null;
  }

  const result = parseComposerOutput(raw);
  if (result === null) return null;

  const { prose, facts: incoming } = splitReply(result.text);

  appendTurn(deps.db, { role: "user", text: message }, now);
  appendTurn(deps.db, { role: "atlas", text: prose }, now);
  if (incoming.length > 0) {
    writeFacts(
      deps.db,
      mergeFacts(facts, incoming, now, (n) => `${now}-${n}`),
    );
  }
  // Only mark the day if a question was actually asked, so a quiet day does
  // not consume the one question it was entitled to.
  if (stale) writeAskedDay(deps.db, today);

  return prose;
}
