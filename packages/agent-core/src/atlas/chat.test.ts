import { expect, it } from "vitest";
import {
  ATLAS_AUTHOR,
  ATLAS_AUTHOR_HEADER,
  airlockMcpConfig,
  buildChatArgs,
  buildChatPrompt,
  CHAT_ALLOWED_TOOLS,
  CHAT_DENIED_TOOLS,
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

it("gives the conversation real tools, unlike the composer", () => {
  // The composer has none by design. Reusing its argv here left Atlas unable
  // to read a file, grep a repo or run git log, so every question outside the
  // daily snapshot got "I cannot know that".
  const a = buildChatArgs([]);
  const i = a.indexOf("--allowed-tools");
  expect(i).toBeGreaterThanOrEqual(0);
  for (const t of ["Bash", "Read", "Grep", "WebSearch"]) {
    expect(CHAT_ALLOWED_TOOLS).toContain(t);
    expect(a).toContain(t);
  }
});

it("refuses to write or edit, keeping the spec's boundary", () => {
  // Atlas reads and decides; AirLock edits. This panel has no diff view, no
  // approval step and no undo.
  const a = buildChatArgs([]);
  expect(a).toContain("--disallowed-tools");
  for (const t of ["Write", "Edit", "NotebookEdit"]) {
    expect(CHAT_DENIED_TOOLS).toContain(t);
    expect(a).toContain(t);
  }
  expect(CHAT_ALLOWED_TOOLS).not.toContain("Write");
  expect(CHAT_ALLOWED_TOOLS).not.toContain("Edit");
});

it("grants access to the project roots, or Atlas cannot read them", () => {
  // Without --add-dir, Claude Code confines file access to the cwd.
  const a = buildChatArgs(["/p/one", "/p/two"]);
  expect(a).toContain("--add-dir");
  expect(a).toContain("/p/one");
  expect(a).toContain("/p/two");
  expect(buildChatArgs([])).not.toContain("--add-dir");
});

it("includes commit dates and subjects, not just a count", () => {
  // The bug this pins: portfolio() rendered "3 recent commits" and dropped the
  // commits, so Atlas correctly reported having no dates and no messages.
  const out = buildChatPrompt(
    input({
      snaps: [
        snap("/p/ElArqui", {
          commits: [
            {
              hash: "a1",
              at: Date.UTC(2026, 7, 26),
              subject: "Spec the admin panel",
            },
          ],
        }),
      ],
    }),
  );
  expect(out).toContain("Spec the admin panel");
  expect(out).toContain("2026-08-26");
});

it("tells Atlas it can screenshot and record the screen", () => {
  // It always COULD -- it has Bash and macOS ships screencapture -- but a tool
  // it does not know about is a tool it never uses.
  expect(CHAT_SYSTEM_PROMPT).toContain("screencapture");
  expect(CHAT_SYSTEM_PROMPT).toMatch(/-v\b/); // video recording
  expect(CHAT_SYSTEM_PROMPT).toMatch(/kill -INT/); // stopping a long recording
  expect(CHAT_SYSTEM_PROMPT).toMatch(/Screen Recording permission/i);
});

it("hands Atlas AirLock's own MCP server when one is running", () => {
  const a = buildChatArgs([], { port: 4319, token: "tok" });
  expect(a).toContain("--mcp-config");
  const cfg = a[a.indexOf("--mcp-config") + 1] as string;
  expect(JSON.parse(cfg)).toEqual({
    mcpServers: {
      airlock: {
        type: "http",
        url: "http://127.0.0.1:4319/mcp",
        headers: {
          Authorization: "Bearer tok",
          // Atlas's identity, so main can stamp its terminal input. See the
          // authorship test below.
          "X-Airlock-Author": "atlas",
        },
      },
    },
  });
  // --allowed-tools does not wildcard, so the server must be named.
  expect(a).toContain("mcp__airlock");
});

it("still passes --strict-mcp-config, so no OTHER server is loaded", () => {
  // The cost measurement behind that flag depends on it: Atlas gets AirLock's
  // tools and nothing else, not the user's whole MCP roster.
  const a = buildChatArgs([], { port: 1, token: "t" });
  expect(a).toContain("--strict-mcp-config");
  expect(airlockMcpConfig(1, "t")).not.toContain("Neon");
});

it("omits MCP entirely when the server is not running", () => {
  const a = buildChatArgs([]);
  expect(a).not.toContain("--mcp-config");
  expect(a).not.toContain("mcp__airlock");
  expect(a).toContain("--strict-mcp-config");
});

it("tells Atlas it can drive AirLock", () => {
  expect(CHAT_SYSTEM_PROMPT).toMatch(/AIRLOCK/i);
  expect(CHAT_SYSTEM_PROMPT).toMatch(/open a terminal|project tabs/i);
});

it("NAMES ATLAS AS THE AUTHOR on its own MCP client", () => {
  // AirLock stamps Atlas's terminal input with a signature so a project's
  // Claude does not read a portfolio agent's inference as its user's
  // instruction. The stamp has to be decided from something Atlas does NOT
  // control: it supplies tool arguments, never the transport's headers. So the
  // identity rides here, in the config AirLock writes for it.
  const cfg = JSON.parse(airlockMcpConfig(4242, "tok")) as {
    mcpServers: { airlock: { headers: Record<string, string> } };
  };
  // The LITERALS are asserted too: with both constants merely imported, an
  // undefined header name reading an undefined value would have passed this
  // test while wiring nothing.
  expect(ATLAS_AUTHOR_HEADER).toBe("X-Airlock-Author");
  expect(ATLAS_AUTHOR).toBe("atlas");
  expect(cfg.mcpServers.airlock.headers["X-Airlock-Author"]).toBe("atlas");
  // Still authorized, obviously.
  expect(cfg.mcpServers.airlock.headers.Authorization).toBe("Bearer tok");
});

const focusBase = {
  history: [],
  facts: [],
  snaps: [],
  question: null,
  message: "what is left here?",
};

it("names the project the chat was opened FROM, when there is one", () => {
  // The spine opens this chat from a dot, so the question is about that
  // project. Without saying so, "what is left here?" is unanswerable and
  // Atlas answers about the whole portfolio instead.
  const out = buildChatPrompt({ ...focusBase, focusRoot: "/p/ElArqui" });
  expect(out).toContain("ElArqui");
  expect(out).toMatch(/FOCUS/);
});

it("says nothing about focus for the portfolio-wide chat", () => {
  expect(buildChatPrompt(focusBase)).not.toMatch(/FOCUS/);
  expect(buildChatPrompt({ ...focusBase, focusRoot: null })).not.toMatch(
    /FOCUS/,
  );
});
