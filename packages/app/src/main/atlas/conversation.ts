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
  MAX_HISTORY_TURNS,
  mergeFacts,
  parseComposerOutput,
  pickDailyQuestion,
  questionFor,
  splitReply,
} from "@airlock/agent-core";
import type { SpawnFn } from "./composer";
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
  now(): number;
  tzOffsetMinutes(): number;
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
    // The most recent snapshot; null (never collected) is an empty portfolio.
    snaps: readSnapshot(deps.db, today) ?? [],
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
