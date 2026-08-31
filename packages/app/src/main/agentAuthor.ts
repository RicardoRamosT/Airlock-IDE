// WHO TYPED THIS, stamped by main rather than claimed by the model.
//
// Atlas can type into a terminal where a Claude session is running
// (send_terminal_input), and what arrives there is indistinguishable from the
// user typing it. Atlas also writes in the user's register -- "fix these two
// defects, commit them separately, do not push" -- so the receiving session
// reads a portfolio agent's inference as its user's instruction, and treats
// claims it should verify as ground truth it already has. That is a real
// hazard: Atlas is often right, and when it is wrong the receiving agent has no
// way to know it was ever an agent talking.
//
// THE SIGNATURE IS APPLIED HERE, ON THE WAY TO THE PTY -- deliberately not by
// asking Atlas to sign its own messages in the system prompt. A model can
// forget, paraphrase, or omit; and a signature the sender controls is worth
// nothing to the reader, which is the same reason renderStillOpen is rendered
// by code and a concern's trend is computed main-side. Atlas supplies only the
// tool argument; it cannot reach the header that names it, so it can neither
// suppress the stamp nor forge the user's voice.
//
// ASCII comments only.

import { ATLAS_AUTHOR_HEADER } from "@airlock/agent-core";

// The authors main can stamp for. Deliberately a closed set: the author picks
// the WORDING, so an arbitrary string must never reach a pty.
export type AgentAuthor = "atlas";

// Set by Atlas's own MCP client config (airlockMcpConfig, agent-core), imported
// rather than restated so the writer and the reader cannot drift.
const HEADER = ATLAS_AUTHOR_HEADER.toLowerCase();

// ONE LINE, AND A SHELL COMMENT.
//
// `#` is load-bearing twice over: it reads as an aside to anything parsing
// prose, and a signed payload that lands in a SHELL rather than in a Claude
// session is then a comment instead of a bogus command. Kept to one line
// because it rides the user's own prompt and must not dominate it.
export const AGENT_SIGNATURES: Record<AgentAuthor, string> = {
  atlas:
    "# (Sent by Atlas, AirLock's portfolio agent, not by the user. " +
    "Verify its claims before acting on them.)",
};

// A DISPATCH IS A SENTENCE; AN ANSWER IS A TOKEN.
//
// send_terminal_input does three jobs (its own description says so): type a
// prompt into a live Claude session, answer an interactive prompt, or send a
// keystroke. Only the first carries claims worth attributing, and the other two
// must not be touched -- appending anything to "y" or to Ctrl-C is corruption,
// not attribution.
//
// Words, not characters: an interactive answer is one token and a file path
// sails past any character floor, while a dispatched instruction is prose. Five
// words is a sentence. The boundary is a real choice, not an accident: a
// three-word "yes do it" goes unsigned, which is honest -- it asserts nothing to
// verify.
export const SIGN_MIN_WORDS = 5;

function wordCount(s: string): number {
  return s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length;
}

// Read the author off a request's headers. Node lower-cases incoming header
// names, but this tolerates any case rather than depending on that, and refuses
// anything that is not one of ours (including an array, which is what a
// duplicated header parses to).
export function authorFromHeaders(
  headers: Record<string, unknown>,
): AgentAuthor | null {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== HEADER) continue;
    if (typeof v !== "string") return null;
    const claimed = v.trim().toLowerCase();
    return claimed in AGENT_SIGNATURES ? (claimed as AgentAuthor) : null;
  }
  return null;
}

// Stamp a terminal payload with its author, or hand it back untouched.
//
// The signature goes INSIDE the last line, before the submit that sends it --
// not after. After the trailing newline it would be submitted separately, so a
// Claude session would receive the signature as a prompt of its own and answer
// it. Placed before, it rides the same submission and reads as what it is: a
// note at the end of the message.
//
// Unsubmitted input is never signed: nothing has been dispatched yet, the user
// or the agent is still typing, and a stamp would land mid-sentence.
export function signAgentInput(
  input: string,
  author: AgentAuthor | null,
): string {
  if (author === null) return input;
  const signature = AGENT_SIGNATURES[author];

  const submit = /[\r\n]+$/.exec(input);
  if (submit === null) return input;

  const body = input.slice(0, input.length - submit[0].length);
  // Idempotent: a re-send, or an Atlas that wrote the line itself, must not
  // collect a second copy.
  if (body.includes(signature)) return input;
  if (wordCount(body) < SIGN_MIN_WORDS) return input;

  return `${body} ${signature}${submit[0]}`;
}
