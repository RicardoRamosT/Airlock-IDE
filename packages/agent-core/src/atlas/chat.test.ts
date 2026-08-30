import { expect, it } from "vitest";
import {
  buildChatPrompt,
  CHAT_MODEL,
  CHAT_SYSTEM_PROMPT,
  MAX_HISTORY_TURNS,
  type Turn,
} from "./chat";
import type { RootSnapshot } from "./collect";
import type { AtlasFact } from "./facts";
import { FACTS_OPEN } from "./reply";

const snap = (
  root: string,
  over: Partial<RootSnapshot> = {},
): RootSnapshot => ({
  root,
  missing: false,
  isRepo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  dirty: 0,
  commits: [],
  ...over,
});

const fact = (over: Partial<AtlasFact> = {}): AtlasFact => ({
  id: "f0",
  project: "Muros-Estates",
  kind: "deadline",
  value: "2026-09-15",
  verbatim: "Muros is due the 15th",
  saidAt: 1000,
  supersededAt: null,
  ...over,
});

const input = (over = {}) => ({
  history: [] as Turn[],
  facts: [] as AtlasFact[],
  snaps: [snap("/p/Muros-Estates")],
  question: null as string | null,
  message: "what should I do today?",
  ...over,
});

it("uses Opus for conversation, unlike the Sonnet debrief", () => {
  // Compressing a git log and answering "what should I work on" are different
  // jobs (spec section 7).
  expect(CHAT_MODEL).toContain("opus");
});

it("includes the user's message and the portfolio", () => {
  const out = buildChatPrompt(input());
  expect(out).toContain("what should I do today?");
  expect(out).toContain("Muros-Estates");
});

it("includes what the user has already told Atlas", () => {
  const out = buildChatPrompt(input({ facts: [fact()] }));
  expect(out).toContain("2026-09-15");
  expect(out).toContain("Muros is due the 15th");
});

it("omits superseded facts, which Atlas no longer believes", () => {
  const out = buildChatPrompt(
    input({ facts: [fact({ value: "OLDVALUE", supersededAt: 2000 })] }),
  );
  expect(out).not.toContain("OLDVALUE");
});

it("includes prior turns so the conversation has continuity", () => {
  const out = buildChatPrompt(
    input({
      history: [
        { role: "user", text: "is ezlis alive?" },
        { role: "atlas", text: "It has been dormant since April." },
      ],
    }),
  );
  expect(out).toContain("is ezlis alive?");
  expect(out).toContain("dormant since April");
});

it("caps history so a long conversation cannot grow without bound", () => {
  const history: Turn[] = Array.from({ length: 200 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "atlas",
    text: `turn number ${i}`,
  }));
  const out = buildChatPrompt(input({ history }));
  expect(out).toContain("turn number 199");
  // Count occurrences, not substring hits: "turn number 1" is a substring of
  // "turn number 18", so a filter over history.includes() over-counts.
  const kept = out.split("turn number ").length - 1;
  expect(kept).toBe(MAX_HISTORY_TURNS);
  // The oldest turns are the ones dropped.
  expect(out).not.toContain("turn number 179");
});

it("appends the daily staleness question when there is one", () => {
  const out = buildChatPrompt(
    input({ question: 'You said "ezlis is dead" 3 months ago. Still true?' }),
  );
  expect(out).toContain("ezlis is dead");
});

it("tells the model how to emit facts, and to emit none when nothing was said", () => {
  expect(CHAT_SYSTEM_PROMPT).toContain(FACTS_OPEN);
  expect(CHAT_SYSTEM_PROMPT).toMatch(/only.*user.*told|do not invent/i);
});

it("instructs that facts must quote the user verbatim", () => {
  expect(CHAT_SYSTEM_PROMPT).toMatch(/verbatim/i);
});
